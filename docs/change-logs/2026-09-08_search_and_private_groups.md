# Change Log — 2026-09-08 · Search consistency + private group detail

**Branch:** `events-feature-spec`
**Tests:** 1019 passing across 50 suites · build clean
**Verified:** unit only — mocked Mongoose. §6.

Two findings from auditing the three search endpoints against the stated
privacy rules. One is a credential leak.

---

## 1. What was actually wrong

The report was "search APIs not working properly". Checking all three:

| Endpoint | Before | Verdict |
|---|---|---|
| `GET /users/search` | `{items, nextCursor, hasMore}` | ✅ fine |
| `GET /events/search` | `{items, nextCursor, hasMore}` | ✅ fine |
| `GET /groups/search` | **bare array, hardcoded `limit(20)`** | ❌ inconsistent |

Groups search took only `q`. A client sending `?limit=` or `?cursor=` — as the
other two accept — was **silently ignored**, and there was no way past the first
20 results. Now paginated, sorted by `_id`, matching `/users/search`.

## 2. The real finding: `GET /groups/:id` leaked the invite code

Checking the stated rule *"if the group is private, don't show event list,
members, gallery — only rules"* turned up something worse than a missing gate.

`findById` returned the **entire group document** to anyone, with no privacy
check at all. For a private group that included:

| Field | Why it matters |
|---|---|
| **`inviteCode`** | A **bearer credential** — whoever holds it can present it to `POST /groups/join-by-code`. Returning it to a non-member hands out the very thing membership gates. |
| `inviteCodeExpiry` | Tells an attacker how long that code is good for. |
| `locations` | Where the group plays. The event gate hides the schedule; leaking venues undoes half of it. |
| `wallpaper`, `ownerId` | Not individually sensitive, but no reason to expose them. |

A private group is deliberately **discoverable** — that is the point of the
2026-08-26 change — so a stranger reaching its detail page is expected, not an
edge case. Every one of them could read the invite code.

Now narrowed to the **search-card fields plus `rules`**: enough to decide
whether to ask to join, nothing more. An allowlist, not a denylist, so a field
added later is hidden until someone decides otherwise rather than leaking by
default.

**A pending request is still a non-member.** Approval is the gate everywhere
else on this branch, and a pending requester is a stranger until someone accepts
them.

**Public groups are untouched** — they return the whole document. Only their
event listing is gated, which happens in `EventsService.listByGroup`.

## 3. Corrections to the report's premises

Two things in the request did not match the code, and saying so is more useful
than quietly working around them:

**"Hide the gallery"** — there is no `gallery` field on `Group`. It exists only
on `User`. Nothing to hide; either the user gallery was meant, or a group
gallery that has not been built.

**"Should 401 when calling private group event listings"** — it returns **403**,
and that is correct. 401 means *not authenticated*; the caller here **is**
authenticated and simply is not a member, which is exactly 403. It also matters
practically: a 401 typically triggers a client's refresh-and-retry loop, which
would spin pointlessly because a fresh token changes nothing.

Put to the owner as a decision rather than assumed, and **403 was kept**.

## 4. Already correct, verified not changed

- **Private groups appear in search** — no `isPrivate` filter, and the
  projection is a card rather than the document.
- **`GET /events/group/:groupId` 403s a non-member** of a private group, and
  refuses **before** querying events at all. Already covered by a test.
- **`GET /groups/:id/members` 403s** via `assertCanSeeGroupContents`.
- **Search never returned `inviteCode`** — `GROUP_CARD_FIELDS` excludes it. The
  leak was on detail, not search.

## 5. Tests

**9 new privacy cases**, asserting the narrowing directly:

the invite code is never returned (checked both by property and by scanning the
serialised response for the value); `locations` hidden; `rules` still present;
the card fields returned; a **pending** requester narrowed like a stranger; an
**approved** member gets everything; a **public** group is not narrowed; an
anonymous caller is narrowed; and `userRole`/`memberStatus` survive the
narrowing — the client needs `memberStatus` to explain *why* the response is
thin.

**Verified by reverting:** disabling the narrowing fails **4 of the 9**,
including the invite-code test. The other 5 cover the pass-through paths, which
hold either way — worth stating, since a test that cannot fail proves nothing.

**5 existing tests** failed on the search change and were updated to assert the
new contract rather than patched to pass: the controller now forwards three
arguments, the service returns an envelope, and `limit(21)` is the lookahead
rather than a regression from 20. Two new controller cases cover limit/cursor
pass-through and that a non-numeric limit reaches the service as `NaN` for
`clampLimit` to handle — the controller must not pre-empt it with a second,
divergent clamp.

## 6. What is NOT verified

- **No live database.** The narrowing has never run against a real group
  document, so a field present in Mongo but absent from the schema would pass
  through the allowlist untested. (It would be *excluded*, which is the safe
  direction.)
- **No client has consumed either change.** Both are breaking: search returns an
  envelope, and private-group detail is thinner.
- **The `403` was verified by reading the code and its existing test**, not by
  calling the running API.

## 7. Usage

```bash
URL=http://localhost:3000
TOKEN=<Cognito ACCESS token>
```

### Search groups, including private ones

```bash
curl -s "$URL/groups/search?q=sunday&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": {
    "items": [
      {
        "_id": "6a6b2366f78b66d63a911a9e",
        "name": "FC Secret",
        "handle": "fcsecret",
        "description": "invite only",
        "logo": null,
        "sportType": "football",
        "country": "mm",
        "city": "yangon",
        "isPrivate": true,
        "maxPlayers": 22
      }
    ],
    "nextCursor": "eyJpIjoiNmE2YjIzNjZmNzhiNjZkNjNhOTExYTllIn0",
    "hasMore": true
  }
}
```

Read `isPrivate` and render a lock badge — navigating straight in will 403 on
members and events.

### Next page

```bash
curl -s "$URL/groups/search?q=sunday&cursor=eyJpIjoiNmE2YjIzNjZmNzhiNjZkNjNhOTExYTllIn0" \
  -H "Authorization: Bearer $TOKEN"
```

### Private group detail as a NON-member

```bash
curl -s "$URL/groups/6a6b2366f78b66d63a911a9e" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": {
    "rules": "No smoking. Arrive 15 minutes early.",
    "_id": "6a6b2366f78b66d63a911a9e",
    "name": "FC Secret",
    "handle": "fcsecret",
    "description": "invite only",
    "logo": null,
    "sportType": "football",
    "country": "mm",
    "city": "yangon",
    "isPrivate": true,
    "maxPlayers": 22,
    "userRole": null,
    "memberStatus": null
  }
}
```

No `inviteCode`, no `locations`, no `wallpaper`. `memberStatus: null` is the
signal to render a join prompt; `"pending"` means the request is already in.

### The same group as an APPROVED member

Everything is returned, `inviteCode` included.

### Private group events without joining — 403

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "$URL/events/group/6a6b2366f78b66d63a911a9e" \
  -H "Authorization: Bearer $TOKEN"
# 403
```

```json
{
  "statusCode": 403,
  "message": "This group is private — join it to see its events",
  "error": "Forbidden"
}
```

**403, not 401** — see §3. Do not trigger a token refresh on this; show a
"request to join" prompt.

### Members, same rule

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "$URL/groups/6a6b2366f78b66d63a911a9e/members" \
  -H "Authorization: Bearer $TOKEN"
# 403
```
