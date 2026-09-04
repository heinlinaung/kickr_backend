# Change Log — 2026-09-04 · `GET /notifications` cursor pagination

**Branch:** `events-feature-spec`
**Tests:** 910 passing across 43 suites · build clean
**Verified:** unit only — mocked Mongoose. §7 lists what that leaves open.

`GET /notifications` returned every notification a user had ever received, as a
bare array, with no limit. It is now a keyset-paginated page.

---

## 1. Breaking response shape

```diff
- { "data": [ {...}, {...} ] }
+ { "data": { "items": [...], "nextCursor": "eyJ...", "hasMore": true } }
```

A client doing `response.data.map(...)` breaks. This matches the envelope the
user- and event-search endpoints already return, so it is one shape across the
API rather than a second convention.

## 2. The sort had to change, and that is the interesting part

The old sort was `{ isRead: 1, createdAt: -1 }` — unread first, then newest.
**That ordering cannot be paginated safely**, because `isRead` *changes*.

Marking a notification read moves it from the unread block to the read block,
i.e. across a page boundary. A client mid-pagination then either skips rows
(one moved past the cursor) or sees duplicates (one moved back before it). No
cursor encoding fixes this; the sort key itself is unstable.

So the paginated feed sorts on **`createdAt` alone**. It never changes, so every
page boundary stays where it was.

The cost is real and worth stating: **unread notifications are no longer grouped
at the top.** Every row still carries `isRead`, so a client badges or filters on
it — which it must do anyway to render an unread indicator.

This was put to the owner as a decision rather than assumed, since it changes
observable ordering for existing clients. An `unreadCount` field was offered and
declined; it can be added later without another breaking change.

## 3. `_id` is the tiebreaker, not decoration

The sort is `{ createdAt: -1, _id: -1 }`.

A single fan-out writes one row per recipient in one `insertMany`, so
notifications routinely share a `createdAt` **to the millisecond**. On
`createdAt` alone the ordering is not total, and a page boundary landing inside
such a group would drop the rest of it — the row is neither before nor after the
cursor in a well-defined way.

The keyset predicate therefore has two branches: an older `createdAt`, **or** the
same `createdAt` with a smaller `_id`.

## 4. Descending pagination needed a change to the shared helper

`keysetFilter()` only emitted `$gt`, because both existing cursor endpoints
(user search, event search) sort **ascending**. A newest-first feed pages forward
into *older* rows, which is `$lt`.

It now takes a `direction: 1 | -1` parameter, defaulting to `1` so both existing
call sites are untouched. Extending the shared helper rather than writing a
second one keeps a single implementation of the two-branch tiebreaker logic,
which is the part that is easy to get wrong.

> Getting the direction wrong does **not** error — it silently re-serves the
> page the client already had. A test asserts the exact `$lt` predicate, and it
> fails when the direction is flipped.

## 5. Deduplicated `clampLimit`

`clampLimit` existed **twice**, copy-pasted in `users.service.ts` and
`events.service.ts`, each with its own `DEFAULT_SEARCH_LIMIT = 20`. Adding a
third copy for notifications would have been three places to fix the next time
something like the `NaN` bug turned up — that bug (`?limit=abc` →
`.limit(NaN)` → the entire collection) had to be fixed once already.

Both copies now import `clampLimit`, `DEFAULT_PAGE_LIMIT` and `MAX_PAGE_LIMIT`
from `common/pagination/cursor.ts`. Behaviour is unchanged: same default, same
1–50 clamp, same `Number.isFinite` guard.

## 6. Indexes

Added `{ userId: 1, createdAt: -1, _id: -1 }`, which matches the new query and
sort exactly, `_id` included because it is in the sort.

The old `{ userId: 1, isRead: 1, createdAt: -1 }` is **kept**: it no longer
serves the list, but `markAllRead` and any unread count still filter on
`isRead`.

## 7. What is NOT verified

- **No live-database run.** Every test mocks Mongoose, so the two indexes have
  never been built and no query plan has been checked. In particular, that the
  new index is actually *used* (rather than an in-memory sort) is asserted by
  construction, not observed.
- **`createdAt` is assumed to exist on every legacy row.** It comes from
  `timestamps: true` and has been on the schema from the start, so this should
  hold — but it is the same class of assumption as the Mongoose
  defaults-apply-on-write trap hit repeatedly on this branch. A row without
  `createdAt` sorts unpredictably and would be unreachable by cursor.
- **No client has consumed the new shape.** The breaking change is documented
  but not exercised end to end.

Worth checking against real data: page through a user with 60+ notifications and
confirm no row is skipped or repeated across boundaries, particularly where many
share a `createdAt` from one fan-out.

## 8. Tests

18 new cases in `notifications.service.pagination.spec.ts` — the endpoint
previously had **none**, which is how it stayed unpaginated and unnoticed:

- the envelope shape, and that the query is scoped to the caller
- the sort is `{createdAt: -1, _id: -1}` and does **not** include `isRead`
- page size: default 20, explicit, capped at 50, `NaN` fallback, floor of 1
- the keyset predicate is `$lt` on both branches, and the user scope survives
  alongside it — a keyset that *replaced* the filter would leak other users'
  rows, so that is asserted directly
- malformed and forged cursors give 400 (a non-ObjectId `i` would otherwise
  reach Mongoose's caster as a 500)
- lookahead: trimmed to the page size, `hasMore` honest, empty page, and the
  cursor is built from the **last returned** row rather than the lookahead row
  — encoding the lookahead would skip it on the next page

Also corrected a **documentation bug** found while writing this up: the API doc
showed the read flag as `read`. It is `isRead`. A client trusting the doc would
have read `undefined` and rendered every notification as unread.
