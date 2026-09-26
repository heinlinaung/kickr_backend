# 2026-09-26 — Rating API (spec §4.10)

One mechanism to rate **players, events and groups**: 1–5 stars, an optional
written review (max 500 chars), optionally anonymous. New `ratings`
collection and module (`src/ratings/`), same polymorphic
`targetType`/`targetId` shape as photos.

## Endpoints (all JWT)

### `POST /ratings`

```json
{
  "targetType": "event",            // "player" | "event" | "group"
  "targetId": "<id>",               // user id for "player"
  "stars": 4,                       // 1..5, required
  "description": "Great pitch",     // optional, <= 500 chars
  "isAnonymous": true               // optional, default false
}
```

**One rating per user per target** (unique index). Submitting again
REPLACES your previous rating — stars, text and anonymity together — so
"edit my review" is the same request and there is no PATCH. An omitted
`description` clears the old one.

### `GET /ratings?targetType=&targetId=&limit=&cursor=`

One target's ratings, newest first, keyset-paginated
(`{ items, nextCursor, hasMore }`). Each item:

```json
{
  "_id": "...", "targetType": "event", "targetId": "...",
  "stars": 4, "description": "Great pitch", "isAnonymous": false,
  "rater": { "_id": "...", "name": "...", "username": "...", "profileImage": "..." },
  "mine": false,
  "createdAt": "...", "updatedAt": "..."
}
```

### `GET /ratings/summary?targetType=&targetId=`

```json
{
  "targetType": "group", "targetId": "...",
  "count": 3, "average": 4.3,
  "breakdown": { "1": 0, "2": 0, "3": 1, "4": 0, "5": 2 },
  "myRating": { ... } | null
}
```

Average is 1-decimal, computed on read — never stored, so it cannot drift.
`myRating` lets the client pre-fill the edit form. Reading is open to any
authenticated user; only WRITING is gated.

### `DELETE /ratings/:id`

Author only (403 otherwise).

## Eligibility — rating is reserved for people who were there

| Target | Who may rate | Blocked |
|---|---|---|
| group  | approved members | owner (400 own group), pending/strangers (403) |
| event  | joined players, once the event is `after_match` or `done` | organizer (400), unfinished or **cancelled** event (400), non-roster (403) |
| player | someone who shared a **finished** event with them | yourself (400), never played together / event not finished (403) |

Missing target → 404. Unknown `targetType` / malformed `targetId` → 400.

## Anonymous ratings

`raterId` is ALWAYS stored — without it there is no one-rating-per-user rule
and no edit/delete. Anonymity is applied at read time: everyone else sees
`rater: null`; the author sees their own row unmasked with `mine: true`,
and the service never even queries the user documents of masked raters.

## Profile hook

`GET /users/:id` statistics' `avgRating` (stubbed 0 since §4.4) is now the
user's real average **player** rating, 0 when unrated. Event/group stars do
not leak into a profile.

## Mobile notes

- Rate + edit are the same call; read `myRating` from the summary to decide
  between "Rate" and "Edit your rating" UI.
- 403 means "you weren't part of this" — hide the rating entry point; 400
  messages are user-showable ("You cannot rate your own group", "Only a
  finished event can be rated (event is 'playing')").
- No new deploy steps: no seeder, no env change. Indexes are created by
  Mongoose on boot.
