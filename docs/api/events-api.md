# Events API — Flutter Integration Guide

**Audience:** Flutter developers integrating the KickR mobile app.
**Base URL (local):** `http://localhost:3000`
**Swagger UI:** `http://localhost:3000/api-docs` · **OpenAPI JSON:** `/api-docs-json`
**Status:** build steps 1–4 implemented — lifecycle core, teams/fixtures/standings, after-match (MVP, cover, photos), and discovery (geo, templates, likes). Verified against MongoDB on **2026-08-09**. Remaining gaps are listed in §9; the teams flow is documented in §11.
**See also:** [Auth API](./auth-api.md) for obtaining the access token · [Groups & Locations API](./groups-and-locations-api.md) for `groupId` and `locationId`.

> ## ⚠️ Breaking change — event `status` values have changed
>
> The old `open | full | done` enum is **gone**. Events now use a 6-state lifecycle:
> `join → before_match → preparation → playing → after_match → done`.
>
> - `open` → **`join`**
> - `full` → **removed entirely.** A full event stays in `join`; use the new derived **`isFull`** boolean instead.
> - `done` → unchanged.
>
> Any build that string-matches `"open"` or `"full"` will break. Migrate to `status == 'join'` + `isFull`.

---

## 1. Conventions

Identical to the groups doc — repeated here so this page stands alone.

### 1.1 Success responses are wrapped in `data`

```json
{ "data": { "...": "the actual payload" } }
```

```dart
final payload = (jsonDecode(res.body) as Map<String, dynamic>)['data'];
```

### 1.2 Errors are NOT wrapped, and `message` may be a list

```json
{
  "statusCode": 401,
  "timestamp": "2026-08-08T19:53:32.062Z",
  "path": "/events/group/6a6cce80419acf83c69c01a7",
  "message": "Unauthorized"
}
```

Validation failures return `message` as a **list of strings**. Handle both or you will crash on a 400.

### 1.3 Auth

Every endpoint on this page requires `Authorization: Bearer <accessToken>` — the Cognito **access** token, not the `idToken`. Missing or invalid → `401`.

### 1.4 IDs are Mongo ObjectId strings

24-char hex. A malformed id returns `400`, a well-formed but unknown one `404`.

---

## 2. The Event object

Captured from the live API (`GET /events/group/:groupId`, 2026-08-09):

```json
{
  "_id": "6a7055f42e55b9cdbe427eb4",
  "title": "Aura Bangkok Group(Thurday)",
  "description": "This is the event for thurdays",
  "date": "2026-08-05T23:00:00.000Z",
  "groupId": "6a6cce80419acf83c69c01a7",
  "isPublic": false,
  "createdBy": "6a697843f720782b1d747e1e",
  "locationId": "6a6e223e419acf83c69c01a9",
  "maxPlayers": 32,
  "joinedCount": 0,
  "sportType": "futsal",
  "skillLevel": "beginner",
  "price": 120,
  "status": "join",
  "startTime": null,
  "endTime": null,
  "teamCount": 4,
  "coverImage": null,
  "coverImageFileId": null,
  "photos": [],
  "result": null,
  "templateId": null,
  "likeCount": 0,
  "isFull": false,
  "createdAt": "2026-08-03T08:48:52.719Z",
  "updatedAt": "2026-08-03T08:48:52.719Z",
  "__v": 0
}
```

### 2.1 Fields that fill in later in the lifecycle

The JSON above is a freshly created event, so most optional fields are empty. They populate as the event progresses:

| Field | Filled by |
|---|---|
| `matches` | **No longer on the event document** — fixtures are their own collection. `GET /events/:id` still attaches them as `matches`, and `GET /events/:id/matches` returns the same rows (§11). |
| `result` | `POST /events/:id/result`, during `after_match` |
| `coverImage`, `coverImageFileId` | `POST /events/:id/cover` |
| `photos` | `POST /events/:id/photos`, during `after_match` |
| `likeCount` | `POST`/`DELETE /events/:id/like` |
| `templateId` | set at creation when `POST /events` is given a `templateId` |
| `startTime`, `endTime` | optional, set at create or via `PATCH /events/:id` |

Model them as nullable/empty and render accordingly — an event in `join` legitimately has all of them empty.

`teamCount` (default `4`) is advisory: it tells your shuffle UI how many teams to aim for, but the server accepts whatever roster you submit.

### 2.2 `isFull` is derived — there is no `full` status

`isFull == joinedCount >= maxPlayers`, computed per request. It is **not stored**, so it can never drift from `joinedCount`. A full event's `status` stays `"join"`.

```dart
// WRONG — 'full' no longer exists
if (event.status == 'full') showFullBadge();

// RIGHT
if (event.isFull) showFullBadge();
```

### 2.3 `date` vs `startTime`/`endTime`

`date` is the only real scheduling field today and is **required**. `startTime`/`endTime` exist for a future split of match date and kick-off time; both are `null` on every event. Use `date`.

---

## 3. The lifecycle

```
join → before_match → preparation → playing → after_match → done
```

| Status | Meaning |
|---|---|
| `join` | Registration open. Players can join/leave. |
| `before_match` | Registration closed, waiting for match time. |
| `preparation` | Teams being assigned; fixtures submitted here. |
| `playing` | Match in progress; scores can be entered. |
| `after_match` | Match over; MVP/photos/ratings belong here. |
| `done` | Archived. Terminal — nothing can change. |

### 3.1 Legal transitions

| From | To |
|---|---|
| `join` | `before_match` |
| `before_match` | `preparation`, **`join`** (reopen registration) |
| `preparation` | `playing`, **`before_match`** (revert) |
| `playing` | `after_match` |
| `after_match` | `done` |
| `done` | — terminal |

Anything else → **`409`**. You cannot skip states (`join → playing` is rejected), and nothing leaves `done`.

### 3.2 What each state permits

| Action | Allowed when |
|---|---|
| join | `status == 'join'` **and** not full |
| leave | `status == 'join'` |
| submit teams / shuffle | `status == 'preparation'` |
| enter a fixture score | `status` in `playing`, `after_match` |
| MVP / result / photos | `status == 'after_match'` |
| edit / delete event | organizer, any state except `done` |

### 3.3 Who is the "organizer"

The event's `createdBy`, **or** — for group events — an approved `owner`/`admin` of the event's group. The creator keeps control even if they later lose their group role. Anyone else gets `403`.

---

## 4. Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/events` | any user | Public events only. Optional `?region=`, `?near=`/`?radius=`, `?from=`/`?to=`, `?status=`. |
| `GET` | `/events/group/:groupId` | any user | **NEW** — one group's events. Members see private ones too. |
| `POST` | `/events` | organizer | Create. Accepts `startTime`, `endTime`, `teamCount`, `templateId`. |
| `GET` | `/events/:id` | any user | Detail + `groupRules`, `standings`, `likedByMe`. |
| `PATCH` | `/events/:id` | organizer | **NEW** — edit. Rejected when `done`. |
| `DELETE` | `/events/:id` | organizer | **NEW** — hard delete. Rejected when `done`. |
| `PATCH` | `/events/:id/status` | organizer | **NEW** — advance the lifecycle. |
| `POST` | `/events/:id/join` | any user | Gated to `join` + capacity. |
| `DELETE` | `/events/:id/join` | any user | Gated to `join`. |
| `GET` | `/events/:id/players` | any user | Joined players. |
| `PUT` | `/events/:id/teams` | organizer | **NEW** — submit the finalized roster. Gated to `preparation`. See §11. |
| `POST` | `/events/:id/shuffle` | organizer | Server-side colour shuffle (fallback). Gated to `preparation`. See §11. |
| `GET` | `/events/:id/matches` | any user | **NEW** — fixture list. |
| `PATCH` | `/events/:id/matches/:matchNumber` | organizer | **NEW** — enter a score. `playing`/`after_match`. |
| `GET` | `/events/:id/standings` | any user | **NEW** — derived table. |
| `POST` | `/events/:id/result` | organizer | **NEW** — MVP (+ optional overall score). `after_match` only. |
| `POST` | `/events/:id/cover` | organizer | **NEW** — cover image (multipart `file`). |
| `POST` | `/events/:id/photos` | organizer | **NEW** — after-match photo. `after_match` only. |
| `DELETE` | `/events/:id/photos/:fileId` | organizer | **NEW** — remove a photo. |
| `POST` | `/events/:id/like` | any user | **NEW** — idempotent like. |
| `DELETE` | `/events/:id/like` | any user | **NEW** — idempotent unlike. |
| `GET` | `/event-templates` | any user | **NEW** — the caller's templates. |
| `POST` | `/event-templates` | any user | **NEW** — create a template. |
| `DELETE` | `/event-templates/:id` | owner | **NEW** — delete your own template. |

---

## 5. Listing

### 5.1 `GET /events` — public discovery

Returns **only** events with `isPublic: true`, soonest first. Optional `?region=` matches the owning group's country **or** city, case-insensitive; events with no group are excluded when it is set.

> ⚠️ **This will not show a group's private events**, even to its members. For a group's schedule use §5.2.

### 5.2 `GET /events/group/:groupId` — one group's events

```http
GET /events/group/6a6cce80419acf83c69c01a7
Authorization: Bearer <accessToken>
```

Visibility depends on the caller:

| Caller | Sees |
|---|---|
| **Approved** member (any role) | **All** the group's events, public *and* private |
| Pending member | Public events only |
| Non-member | Public events only |

A **pending** member is treated as a non-member — approval is what grants visibility. Verified live: on group `Aura Bangkok`, the approved owner sees the private event, while a pending member and an outsider both receive `[]`.

Optional `?status=` narrows to one lifecycle state:

```http
GET /events/group/6a6cce80419acf83c69c01a7?status=join
```

Sorted by `date` ascending. Each row carries the derived `isFull`.

| Code | When |
|---|---|
| `400` | Malformed `groupId`, or an unknown `status` value (e.g. the legacy `open`) |
| `404` | Group does not exist |

Note the empty-list-vs-404 distinction: an unknown group is `404`, but a real group you cannot see private events in returns `200` with `[]`.

---

## 6. Creating and editing

### 6.1 `POST /events`

```json
{
  "title": "Friday Night Football",
  "description": "Casual 11v11",
  "date": "2026-09-01T18:00:00.000Z",
  "groupId": "6a6cce80419acf83c69c01a7",
  "isPublic": false,
  "locationId": "6a6e223e419acf83c69c01a9",
  "maxPlayers": 22,
  "sportType": "football",
  "skillLevel": "beginner",
  "price": 0
}
```

Only `title` and `date` are required. New events always start at `status: "join"` — you cannot set the status on create.

- **`groupId`** — you must be an approved **owner/admin** of that group, else `403`.
- **`locationId`** — you must be able to edit that location: its creator, **or** an owner/admin/captain of the group that owns it. (This changed: previously only the personal creator could attach one, which blocked group admins from using their own group's ground.)

### 6.2 `PATCH /events/:id`

Organizer only. Send only the fields you are changing: `title`, `description`, `date`, `isPublic`, `locationId`, `maxPlayers`, `teamCount` (2–6), `sportType`, `skillLevel`, `price`, `startTime`, `endTime`.

**`status` is not editable here** — it is ignored/rejected. Use §7. `groupId` cannot be changed either.

Rejected with `400` once the event is `done`.

### 6.3 `DELETE /events/:id`

Organizer only. **Hard delete** — the event and all its player rows are removed. There is no undo and no notification to joined players.

Rejected with `400` when `done`, so completed events survive as history.

> Whether deleting an event with joined players should instead soft-cancel with notifications is still an open product question. Today it is a hard delete.

---

## 7. `PATCH /events/:id/status`

```http
PATCH /events/6a7055f42e55b9cdbe427eb4/status
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "status": "before_match" }
```

Returns the updated event. Organizer only.

| Code | When |
|---|---|
| `400` | `status` is not one of the six values (e.g. `"open"`) |
| `403` | Caller is not the organizer |
| `404` | Event does not exist |
| `409` | The move is not legal from the current state |

**`400` vs `409`** is the distinction to code against: `400` means the value isn't a real status; `409` means it is real but unreachable from where the event is now. Show different messages — the second is recoverable by stepping through intermediate states.

```dart
// Advance one step; surface 409 as "can't do that from here"
final res = await patch('/events/$id/status', {'status': next});
if (res.statusCode == 409) showError('This event is not at that stage yet.');
```

---

## 8. Joining and leaving

### 8.1 `POST /events/:id/join`

Two independent guards: the lifecycle **and** capacity.

| Code | When |
|---|---|
| `409` | Already joined |
| `400` | `Event is not open for joining` — status is not `join` |
| `400` | `Event is full` — `joinedCount >= maxPlayers` |

Both failure messages are `400`; read the message to tell them apart. Capacity is enforced atomically server-side, so two players racing for the last slot cannot both succeed.

Re-joining after leaving works — the cancelled row is reactivated.

### 8.2 `DELETE /events/:id/join`

Only while `status == 'join'`. Once the organizer closes registration, `400` with a message telling the player to ask the organizer to reopen it. Reopening is legal (`before_match → join`).

`404` if you had not joined.

---

## 9. Not built yet

Do **not** design screens against these — the fields exist but nothing fills them.

| Feature | State |
|---|---|
| **Player ratings** | Not built (spec §8, a separate module). `after_match` exists for it to hang off. |
| **`groupId` filter on `GET /events`** | Not implemented — use `GET /events/group/:groupId`. |
| **Team chat messaging** | The rooms exist and archive on `done`, but there is no send/read endpoint yet — `EventTeamChat` is a room record only. |
| **Ownership transfer / group delete** | Still missing, so a group owner cannot leave their own group. |
| **Tournaments, challenges** | Not built (parent spec §6, §10). |

---

## 10. Gotchas checklist

- [ ] **`status: "open"` and `"full"` are gone.** Match `"join"`, and use `isFull` for capacity.
- [ ] `isFull` is **derived**, absent from the stored document — never write it back.
- [ ] `GET /events` hides private events. A group's schedule needs `GET /events/group/:groupId`.
- [ ] A **pending** group member sees only public events — approval is what unlocks private ones.
- [ ] `409` from `/status` means "illegal transition", `400` means "not a status". Different UX.
- [ ] `done` is terminal: edit, delete, and every transition are refused.
- [ ] Unwrap `data` on success; errors are flat and `message` may be a **list**.
- [ ] `date` is the scheduling field; `startTime`/`endTime` are optional extras.
- [ ] Join failures — "not open" and "full" — are **both** `400`; read the message.
- [ ] Deleting an event is a **hard delete** with no notification to joined players.
- [ ] Submit teams with `PUT /events/:id/teams` — **you send the roster, the server generates the fixtures**. Never author `matches[]` client-side.
- [ ] A **partial roster is legal**. Check `unassignedPlayerIds` in the response and warn the user, or players silently start with no team.
- [ ] Scores are `null` until entered — **not `0`**, which is a real scoreline. Render a dash for `null`.
- [ ] `standings` is derived on every read. Never cache or write it back.
- [ ] Resubmitting teams during `preparation` **regenerates fixtures wholesale**, discarding entered scores.

---

## 11. Teams, fixtures and scores

The `preparation`-phase flow, end to end. **The client decides who plays where; the server owns everything derived from that.**

### 11.1 Submitting the roster — `PUT /events/:id/teams`

Shuffle locally, then send the finalized teams. Organizer only, `preparation` only.

```
PUT /events/6a7055f42e55b9cdbe427eb4/teams
{
  "teams": [
    { "name": "Red",    "playerIds": ["665f…a1", "665f…a2"] },
    { "name": "Yellow", "playerIds": ["665f…a3", "665f…a4"] },
    { "name": "Blue",   "playerIds": ["665f…a5", "665f…a6"] },
    { "name": "Black",  "playerIds": ["665f…a7", "665f…a8"] }
  ]
}
```

Response:

```json
{
  "teams": [{ "name": "Red", "playerIds": ["665f…a1", "665f…a2"] }],
  "fixtures": [
    { "matchNumber": 1, "teamA": "Red", "teamB": "Yellow",
      "scoreA": null, "scoreB": null, "playedAt": null }
  ],
  "unassignedPlayerIds": []
}
```

`PUT`, not `POST`: the call replaces the whole assignment, so sending the same body twice leaves the same state.

**Rejected with `400` unless** every `playerId` is a joined player, no player appears in two teams, no id repeats within a team, team names are unique and non-empty, and there are 2–6 teams. The message names the offending id — surface it directly.

**Partial rosters are accepted on purpose** (reserves, late arrivals). Anyone left out keeps `team: null` and comes back in `unassignedPlayerIds`. Warn the user before submitting rather than discovering it at kick-off.

`teamCount` on the event is **advisory** — a hint for your UI. The real count is `teams.length`.

### 11.2 The server-side fallback — `POST /events/:id/shuffle`

No body. Deals joined players across the first `teamCount` colours (Red, Yellow, Blue, Black, Green, Orange) and returns the same shape as `PUT /teams`. Useful for a web client or if the mobile shuffle isn't ready. Both endpoints share one write path — whichever ran last wins, neither is privileged.

> **Changed:** this used to assign numeric teams (`"1"`, `"2"`) in buckets of 6. It now produces colour teams and fixtures.

### 11.3 Fixtures

Generated server-side as a **double round-robin**: every pair meets twice, home and away swapped in the second leg. 4 teams → 12 fixtures, 6 per team. 3 → 6, 2 → 2.

Fixtures are **never client-authored**. You cannot send `matches[]`; a stale app therefore cannot persist a divergent fixture format.

Each fixture is a document in its own collection with a stable `_id`, so it can be referenced from elsewhere — player ratings (§8) attach to a specific match. `GET /events/:id` still returns them inline as `matches` for convenience, so the response shape you consume is unchanged.

Resubmitting during `preparation` regenerates teams and fixtures wholesale. Once the event leaves `preparation` they are locked.

### 11.4 Scores — `PATCH /events/:id/matches/:matchNumber`

```
PATCH /events/6a7055f42e55b9cdbe427eb4/matches/7
{ "scoreA": 3, "scoreB": 2 }
```

Both scores are required; `0` is valid. Allowed in `playing` **and** `after_match`, so a typo can still be corrected after the whistle. Unknown `matchNumber` → `404`.

### 11.5 Standings — `GET /events/:id/standings`

Derived on every read, never stored:

```json
[{ "team": "Red", "played": 6, "won": 4, "drawn": 1, "lost": 1,
   "goalsFor": 12, "goalsAgainst": 5, "goalDifference": 7, "points": 13 }]
```

Win 3 / draw 1 / loss 0. Ordered by points, then goal difference, then goals for, then team name. **Fixtures with a `null` score are skipped as unplayed** — a team that hasn't played still appears with a zero row. The same table rides along on `GET /events/:id` as `standings`.

### 11.6 Team chats

One room per team name is created on submission and archived when the event reaches `done`. Resubmitting the same names keeps the existing rooms; renaming a team creates a new one. There is no messaging endpoint yet (§9).
