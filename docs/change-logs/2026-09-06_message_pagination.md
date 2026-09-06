# Change Log — 2026-09-06 · `GET /groups/:id/messages` cursor pagination

**Branch:** `events-feature-spec`
**Tests:** 1008 passing across 50 suites · build clean
**Verified:** unit only — mocked Mongoose, so the new index has never been
built. §7.

Message history is now keyset-paginated. Closes the gap flagged in
`2026-09-06_send_message_rest.md` §9 a few hours earlier.

---

## 1. Breaking response shape

```diff
- { "data": [ {...}, {...} ] }
+ { "data": { "items": [...], "nextCursor": "eyJ...", "hasMore": true } }
```

A client doing `response.data.map(...)` breaks. Same envelope as
`/notifications` and the search endpoints, so this is one shape across the API
rather than a third convention.

## 2. Why a cap was the wrong shape here

The old route took `limit`, defaulted to 50, capped it at 200, and offered
nothing else — so **a group's chat was unreachable beyond its most recent 200
messages.**

For a notification feed a cap is arguable; for a chat it is not. Scrolling back
through a conversation is the normal thing to do, and the previous design made
it impossible rather than merely slow.

`limit` now defaults to **20** and caps at **50**, matching the other paginated
routes. Lower than the old default on purpose: a page is now cheap to ask for
again, so a smaller one costs nothing and renders sooner.

## 3. `_id` is a real tiebreaker, not decoration

The sort is `{ createdAt: -1, _id: -1 }`, and the index was widened to match.

The previous route sorted on `createdAt` alone, which was acceptable while it
returned one unpaginated page — the ordering within a `createdAt` collision
simply didn't matter. **With paging it does.** Two messages sharing a
millisecond have no defined order between them, so a page boundary landing
inside such a pair can silently drop one. In a chat, that is a missing message
with no error.

The chat API doc previously described this as a known limitation. It is now
closed, and the doc says so rather than being quietly edited.

## 4. Descending, so `$lt`

Paging forward through a newest-first list means going **older**, which is
`$lt` — the `direction: -1` argument added to the shared `keysetFilter` when
`/notifications` needed the same thing.

Getting it wrong does not error. `$gt` would silently re-serve the page just
fetched, which in a chat presents as the scroll being stuck. A test asserts the
exact predicate and fails when the direction is flipped.

## 5. The group scope must survive the keyset

The keyset is merged into the filter with `Object.assign`, **not** substituted
for it. A keyset that replaced the filter would drop `groupId` and return other
groups' messages — the worst possible failure on a private chat.

That is asserted directly, and verified by breaking it: making the keyset
replace the filter fails the test. Worth pinning explicitly rather than trusting
that nobody will refactor it into a reassignment.

## 6. Also folded in

The controller had its own `parseInt` + `Math.min(…, 200)` clamp. It now passes
`Number(limit)` straight through and lets the shared `clampLimit` own the
bounds — the same helper that carries the `Number.isFinite` guard, so
`?limit=abc` cannot reach `.limit(NaN)` and return the whole collection. One
fewer local copy of a clamp that has already had to be fixed once.

## 7. What is NOT verified

- **No live database.** The widened index
  `{groupId: 1, createdAt: -1, _id: -1}` has never been built, and no query plan
  has been checked. That the index is actually *used* rather than an in-memory
  sort is asserted by construction, not observed.
- **The old two-field index was replaced, not kept.** Checked first that only
  two queries touch `messages` — this history read and the group-delete
  `deleteMany`, which filters on `groupId` alone and is still served by the new
  index's prefix. But that was reasoned, not measured.
- **No client has consumed the new shape.** The breaking change is documented
  but not exercised end to end.

Worth checking against real data: page through a group with 60+ messages and
confirm nothing is skipped or repeated across boundaries — particularly where
several share a `createdAt`, which a burst of messages will produce.

## 8. Usage

```bash
URL=http://localhost:3000
TOKEN=<Cognito ACCESS token>
GROUP=6a6b2366f78b66d63a911a9e
```

### Newest page

```bash
curl -s "$URL/groups/$GROUP/messages?limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": {
    "items": [
      {
        "_id": "68b9f1aa22bb33cc44dd0001",
        "senderId": { "_id": "507f191e810c19729de860e1", "name": "Hein", "profileImage": null },
        "text": "See everyone at 7pm",
        "createdAt": "2026-09-06T10:00:00.000Z"
      }
    ],
    "nextCursor": "eyJkIjoiMjAyNi0wOS0wNlQxMDowMDowMC4wMDBaIiwiaSI6IjY4YjkifQ",
    "hasMore": true
  }
}
```

### Scroll further back

```bash
curl -s "$URL/groups/$GROUP/messages?limit=20&cursor=eyJkIjoiMjAyNi0wOS0wNlQxMDowMDowMC4wMDBaIiwiaSI6IjY4YjkifQ" \
  -H "Authorization: Bearer $TOKEN"
```

### Walk the whole conversation

```bash
CURSOR=""
while :; do
  RES=$(curl -s "$URL/groups/$GROUP/messages?limit=20&cursor=$CURSOR" \
    -H "Authorization: Bearer $TOKEN")
  echo "$RES" | jq -r '.data.items[] | "\(.createdAt)  \(.senderId.name): \(.text)"'
  CURSOR=$(echo "$RES" | jq -r '.data.nextCursor // empty')
  [ -z "$CURSOR" ] && break
done
```

The loop sends `?cursor=` empty on its first pass, which is safe: the service
guard is `if (cursor)`, a truthiness check, so an empty value is skipped rather
than reaching `decodeCursor` and 400ing.

### Just the page metadata

```bash
curl -s "$URL/groups/$GROUP/messages?limit=3" -H "Authorization: Bearer $TOKEN" \
  | jq '{count: (.data.items | length), hasMore: .data.hasMore, nextCursor: .data.nextCursor}'
```

### A bad cursor is a 400

```bash
curl -s "$URL/groups/$GROUP/messages?cursor=garbage" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "statusCode": 400,
  "message": "Invalid cursor",
  "error": "Bad Request"
}
```

Every malformed shape collapses to that one message — not base64, not JSON, a
missing `i`, or an `i` that is not an ObjectId. A cursor is opaque, so there is
nothing actionable to say beyond "start from the newest page".

## 9. Tests

17 new cases in `chat.service.pagination.spec.ts`. The route previously had
**none** — which is how it shipped unpaginated and unnoticed, and why the full
suite stayed green when the return shape changed.

The envelope; the group scope; the sort including the `_id` tiebreaker; that the
sender is still populated (a paginated page must render like an unpaginated one
did); limit defaulting, explicit, capped and the `NaN` fallback; the `$lt`
predicate on both branches; **the group scope surviving alongside the keyset**;
400 on malformed and forged cursors; and the lookahead — trimmed, honest
`hasMore`, empty group, and the cursor built from the **last returned** row
rather than the lookahead row.

**Verified by reverting, twice:**

- flipping the direction to `$gt` fails 1 test — the stuck-scroll bug;
- making the keyset replace the filter instead of merging fails 1 test — the
  cross-group leak.
