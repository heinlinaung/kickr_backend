# Events API — Flutter Integration Guide

**Audience:** Flutter developers integrating the KickR mobile app.
**Base URL (local):** `http://localhost:3000`
**Swagger UI:** `http://localhost:3000/api-docs` · **OpenAPI JSON:** `/api-docs-json`
**Status:** build steps 1–4 implemented — lifecycle core, teams/fixtures/standings, after-match (MVP, cover, photos), and discovery (geo, templates, likes). Verified against MongoDB on **2026-08-13**. Remaining gaps are listed in §9; the teams flow is documented in §11.

> ## ⚠️ Changed 2026-08-20 — new `ready_to_play` stage
>
> A sixth state sits between `preparation` and `playing`:
> `join → preparation → **ready_to_play** → playing → after_match → done`.
>
> **`preparation → playing` is no longer legal and now returns `409`.** Any
> client that starts a match straight from team assignment breaks — kick-off
> must go through `ready_to_play`. This is the one change that needs a client
> release.
>
> What the state is for: the teams are **final and reviewable**, but the match
> has not kicked off. The roster is **frozen** — `POST /events/:id/shuffle` and
> the team-write routes are refused here (`400`), unlike in `preparation`. Score
> entry is still refused too, since there is nothing to score yet.
>
> A reverse edge `ready_to_play → preparation` exists for when the reviewed
> teams turn out wrong: go back, re-shuffle, come forward again. Nothing is lost
> doing so, because no score can have been entered yet.
>
> **No data migration is needed.** No existing event can be in the new state,
> and no stored value becomes invalid — unlike the `before_match` removal below,
> which stranded documents. Existing events keep working; only the transition
> your client requests has to change.
>
> Handle the new value in any `switch` on `status`, and in the `?status=` filter.

> **Changed 2026-08-18:** **`before_match` is gone from the lifecycle** — `join`
> now advances straight to `preparation`, and `preparation → join` reopens
> registration. Sending `"before_match"` to `PATCH /events/:id/status` is a
> `400`. Run `scripts/migrate-remove-before-match.ts` before deploying.
> Also: `assignTeamPlayers` now **rejects a roster larger than the team's
> `numberOfPlayers`**.

> **Changed 2026-08-13:** teams are a two-step flow now (`POST /teams/generate`, then `PATCH /teams/:teamId`) and `PUT /events/:id/teams` is **gone**. `event.duration` decides how many matches exist. See [the changelog](../change-logs/2026-08-13.md).
**See also:** [Auth API](./auth-api.md) for obtaining the access token · [Groups & Locations API](./groups-and-locations-api.md) for `groupId` and `locationId`.

> ## ⚠️ Breaking change — event `status` values have changed
>
> The old `open | full | done` enum is **gone**. Events now use the lifecycle
> `join → preparation → ready_to_play → playing → after_match → done`
> (`ready_to_play` was added 2026-08-20; the original release of this change had
> five states).
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
  "duration": 90,
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
| `matches` | **Not on the event document** — fixtures are their own collection. `GET /events/:id` attaches them as `matches`; `GET /events/:id/matches` returns the same rows (§11). |
| `teams` | Attached to `GET /events/:id` from the Team collection, players populated. Created by `POST /teams/generate` (§11). |
| `location` | `GET /events/:id` resolves `locationId` into a **location object** (name, lat/lng, url, address). `locationId` is still returned for clients that only need the id. |
| `userRole` | On `GET /events/:id`: the caller's role in the owning group (`owner`/`admin`/`captain`/`vice-captain`/`referee`/`member`), or `null` for a non-member or a groupless event. **Not a join indicator** — see `joinedByMe`. |
| `joinedByMe` | On `GET /events/:id`: `true` when the caller is on the roster. Use this for the Join/Leave button. `false` (never absent) when there is no caller, and `false` after leaving — a cancelled row is kept for reactivation but does not count. |
| `result` | `POST /events/:id/result`, during `after_match` |
| `coverImage`, `coverImageFileId` | `POST /events/:id/cover` |
| `photos` | `POST /events/:id/photos`, during `after_match` |
| `likeCount` | `POST`/`DELETE /events/:id/like` |
| `templateId` | set at creation when `POST /events` is given a `templateId` |
| `startTime`, `endTime` | optional, set at create or via `PATCH /events/:id` |
| `additionalPrice` | **NEW** — a surcharge on top of `price`. Settable at create or via `PATCH`. Defaults to `0` |
| `takeAdditionalPrice` | **NEW** — whether `additionalPrice` actually applies. Defaults to `false` |

Model them as nullable/empty and render accordingly — an event in `join` legitimately has all of them empty.

`teamCount` (default `4`, range 2–6) is **the input `POST /events/:id/shuffle` uses** — that route takes no body, so this field is the only thing telling it how many teams to build. It is *not* used by `POST /teams/generate`, which takes `teamsCount` in the body instead — but since 2026-08-27 generate **writes its value back here**, so the field always reflects the split that actually exists (§11.1).

It does not constrain player assignment: `PATCH /teams/:teamId` accepts whatever roster you submit.

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
join → preparation → ready_to_play → playing → after_match → done
```

| Status | Meaning |
|---|---|
| `join` | Registration open. Players can join/leave. |
| `preparation` | Teams being assigned; fixtures submitted here. |
| `ready_to_play` | **NEW** — teams are final and reviewable; kick-off has not happened. The roster is **frozen**: shuffling is refused here. |
| `playing` | Match in progress; scores can be entered. |
| `after_match` | Match over; MVP/photos/ratings belong here. |
| `done` | Archived. Terminal — nothing can change. |

### 3.1 Legal transitions

| From | To |
|---|---|
| `join` | `preparation` |
| `preparation` | **`ready_to_play`**, **`join`** (reopen registration) |
| `ready_to_play` | `playing`, **`preparation`** (re-shuffle a wrong team set) |
| `playing` | `after_match` |
| `after_match` | `done` |
| `done` | — terminal |

Anything else → **`409`**. You cannot skip states (`join → playing` is rejected), and nothing leaves `done`.

### 3.2 What each state permits

| Action | Allowed when |
|---|---|
| join | `status == 'join'` **and** not full |
| leave | `status == 'join'` |
| submit teams / shuffle | `status == 'preparation'` — **not** `ready_to_play` |
| view final teams | `ready_to_play` onwards |
| enter a fixture score | `status` in `playing`, `after_match` |
| MVP / result / photos | `status == 'after_match'` |
| edit / delete event | organizer, any state except `done` |

### 3.3 Who is the "organizer"

The event's `createdBy`, **or** — for group events — an approved `owner`/`admin` of the event's group. The creator keeps control even if they later lose their group role. Anyone else gets `403`.

**One exception: entering match scores.** A group **`referee`** may call
`PATCH /events/:id/matches/:matchNumber` — officiating is what the role is for.
It grants nothing else: a referee cannot edit or delete the event, advance the
lifecycle, generate teams, or upload anything.

| Action | owner / admin | referee | captain / vice-captain / member |
|---|---|---|---|
| Enter a match score | ✅ | ✅ | ❌ |
| Everything else on the event | ✅ | ❌ | ❌ |

The lifecycle gate still applies to a referee — scores only during `playing`
or `after_match`.

---

## 4. Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/events` | any user | Public events **plus the caller's own joined events** (private included). Rows carry `joinedByMe`. Optional `?region=`, `?near=`/`?radius=`, `?from=`/`?to=`, `?status=`. |
| `GET` | `/events/joined` | any user | **NEW** — events the caller has joined, **public and private alike**, soonest first. Expired/`done` hidden unless `?includeExpired=true`. |
| `GET` | `/events/group/:groupId` | any user | **NEW** — one group's events. Members see private ones too. Expired/`done` hidden unless `?includeExpired=true`. |
| `GET` | `/events/search?q=` | any user | **NEW** — free-text on title/description. Public events only. **Cursor-paginated** — returns `{ items, nextCursor, hasMore }`. See §5.3. |
| `POST` | `/events` | organizer | Create. Accepts `startTime`, `endTime`, `teamCount`, `templateId`. |
| `GET` | `/events/:id` | any user | Detail + `groupRules`, `standings`, `likedByMe`, `joinedByMe`. |
| `PATCH` | `/events/:id` | organizer | **NEW** — edit. Rejected when `done`. |
| `DELETE` | `/events/:id` | organizer | **NEW** — hard delete. Rejected when `done`. |
| `PATCH` | `/events/:id/status` | organizer | **NEW** — advance the lifecycle. |
| `POST` | `/events/:id/join` | any user | Gated to `join` + capacity. |
| `DELETE` | `/events/:id/join` | any user | Gated to `join`. |
| `GET` | `/events/:id/players` | any user | Joined players. |
| `GET` | `/events/:id/payments` | any user | **NEW** — payment status. Organizer sees everyone; anyone else sees only their own row. See §12. |
| `PATCH` | `/events/:id/payments/:memberId` | organizer | **NEW** — mark a member paid/unpaid. See §12. |
| `PATCH` | `/events/:id/teams/:teamId/members/:userId/role` | owner/admin/**captain** | **NEW** — set a player's role in a team. See §11.2c. |
| `DELETE` | `/events/:id/players/:userId` | organizer | **NEW** — remove a player from the event. `join` only. See §8.3. |
| `POST` | `/events/:id/teams/generate` | organizer | Create empty teams + the **full** round-robin fixture list. Accepts `colors`. Returns a message only. `preparation` only. See §11.1. |
| `GET` | `/events/:id/teams` | any user | **NEW** — the event's teams, players populated. |
| `PATCH` | `/events/:id/teams/:teamId` | organizer | **NEW** — assign/rename one team. `preparation` only. |
| `POST` | `/events/:id/shuffle` | organizer | Server-side colour shuffle (fallback). Gated to `preparation`. See §11. |
| `GET` | `/events/:id/matches` | any user | **NEW** — fixture list. |
| `POST` | `/events/:id/matches` | organizer | **NEW** — add one fixture by hand (§11.3b). |
| `PATCH` | `/events/:id/matches/:matchNumber` | organizer **or referee** | **NEW** — enter a score. `playing`/`after_match`. |
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

### 5.1 `GET /events` — discovery

Returns every **public** event, **plus every event the caller has joined** —
including private ones. Soonest first.

> **Changed 2026-08-29.** This used to be `isPublic: true` and nothing else, so
> a private group's event was invisible here even to someone on its roster.
> Being on the roster is now the permission, exactly as it is for
> `GET /events/joined`. Every row carries **`joinedByMe`**, so a mixed list can
> be told apart — you can no longer assume a row from this route is public.

The other filters still apply on top: a joined event does **not** bypass an
explicit `?status=`, `?region=`, `?from=`/`?to=` or `?near=` narrowing. Optional `?region=` matches the owning group's country **or** city; events with no group are excluded when it is set.

Group `country`/`city` are stored lowercase, and `region` is lowercased before matching — so `?region=Yangon`, `?region=yangon` and `?region=YANGON` are equivalent. The match is exact on the whole value, not a substring or pattern: `?region=yan` will not find `yangon`.

> ⚠️ **It will not show a private event you have NOT joined**, even if you are
> a member of the owning group. Roster membership is the test, not group
> membership. For a group's full schedule use §5.2.

> ⚠️ **No default date or status filter.** Unlike §5.1b and §5.2, this route
> does not hide past or `done` events — pass `?from=` or `?status=` to narrow
> it. An unfiltered call returns archived events too.

### 5.1b `GET /events/joined` — events you joined

```http
GET /events/joined
GET /events/joined?includeExpired=true
GET /events/joined?status=join
```

Every event where **you** are on the roster, soonest first.

**Visibility is not filtered at all here.** If you are on the roster you see the
event — public or private, group-owned or standalone, and regardless of whether
you belong to the owning group. Being on the roster *is* the permission. This is
the one listing route that behaves that way: `GET /events` hard-filters
`isPublic: true`, and `GET /events/group/:groupId` shows a group's private
events only to approved members.

- An event you **left** is excluded (the roster row survives as `cancelled` for
  reactivation, but does not count).
- **A `done` event is NEVER in this list.** This is the ongoing list, so a
  finished event is excluded even with `includeExpired=true` — that flag is
  about **dates**, not about completion. Reaching a finished event takes an
  explicit `?status=done`, which is the history view.
- Expired events (date before today) are hidden unless `includeExpired=true`,
  matching `GET /events/group/:groupId`.
- An explicit `?status=` replaces the default filter, `done` included.
- Rows carry `isFull` and `joinedByMe: true`, so a card renders identically
  whether it came from here or from `GET /events/:id`.

> Not the same as the profile's `matchHistory` (`GET /users/:id/profile`), which
> is newest-first, carries a narrow projection, and is suppressed entirely when
> the user sets `privacy.showMatchHistory: false`. This route has no privacy
> gate — it is your own data.

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

> **Changed 2026-08-26 — a PRIVATE group now `403`s here.** The table above
> describes a **public** group, where a non-member sees its public events. If
> the *group itself* is `isPrivate: true`, a non-approved caller gets
> **`403`** and no events at all — a private group hides its whole schedule,
> not just its individually-private events. Being able to find the group in
> search must not also reveal when and where it plays.
>
> `403` rather than `[]` on purpose: it lets you render a join prompt instead
> of a misleading "no events yet". Approval is the gate — a pending request
> still `403`s. See [groups §3.4b](./groups-and-locations-api.md).

### 5.3 `GET /events/search` — free-text search

```http
GET /events/search?q=friday%20night
GET /events/search?q=friday&includeExpired=true
GET /events/search?q=friday&limit=50
GET /events/search?q=friday&limit=20&cursor=eyJkIjoi…
Authorization: Bearer <accessToken>
```

Returns a **page object**, not a bare array:

```json
{
  "data": {
    "items": [{ "_id": "…", "title": "Friday night five", "isFull": false }],
    "nextCursor": "eyJkIjoiMjAyNi0wOS0wMVQxMDowMDowMC4wMDBaIiwiaSI6IjZhNmMifQ",
    "hasMore": true
  }
}
```

> ⚠️ **`data` is an object here**, unlike §5.1/§5.2 which return arrays. Read
> `data.items`. A build doing `List.from(json['data'])` breaks on this route.

Case-insensitive **substring** match on `title` **or** `description`, soonest
first. Not a whole-word or prefix match: `?q=rida` finds "Friday night five".

**Public events only.** Like `GET /events`, this hard-filters `isPublic: true`,
so a group's private event never surfaces here — *even for an approved member*.
For a group's own schedule use §5.2, which is the only route that reveals
private events to members.

- **An empty or whitespace-only `q` returns an empty page** (`items: []`,
  `hasMore: false`), not every event. It is a search, not a listing — use
  `GET /events` to browse.
- Expired events (date before today) and `done` events are hidden unless
  `includeExpired=true`, matching §5.1b and §5.2.
- `includeExpired` is true **only** for the exact string `"true"`. `1`, `yes`
  and `TRUE` are all read as false, so a typo silently narrows rather than
  widens what you see.
- `limit` is a **page size**, defaulting to `20` and clamped to **1–50**. It is
  not a total cap — page with `cursor` to read beyond it. A non-numeric value
  (`?limit=abc`) falls back to `20` rather than erroring.
- Regex metacharacters are escaped, so `?q=a.c` matches the literal text
  `a.c` — not `abc`.
- Rows carry the derived `isFull`, so a card renders the same as one from §5.1.

> There is no relevance ranking. Results are ordered by `date` ascending (with
> `_id` as a tiebreaker), so the soonest event comes first, not the closest title
> match. The first page is therefore the *earliest* matches, not the *best* ones —
> page through with `cursor` to reach the rest.

**Paging.** Cursor-based (keyset), identical in shape to
[users-api §3.5](./users-api.md): omit `cursor` for the first page, then send
`nextCursor` back verbatim until `hasMore` is `false`. The cursor is opaque —
do not parse or construct it; a malformed value is a `400`. Keyset rather than
`skip` means an event created or cancelled mid-scroll cannot make you skip or
re-see a row.

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
- **`locationId`** — you must be able to edit that location: its creator, **or** an owner/admin/captain/vice-captain of the group that owns it. (This changed: previously only the personal creator could attach one, which blocked group admins from using their own group's ground.)

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

{ "status": "preparation" }
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

Only while `status == 'join'`. Once the organizer moves the event to `preparation`, `400` with a message telling the player to ask the organizer to reopen it. Reopening is legal (`preparation → join`).

`404` if you had not joined.

---

### 8.3 `DELETE /events/:id/players/:userId` — organizer removes someone

```http
DELETE /events/6a7055f42e55b9cdbe427eb4/players/6a697843f720782b1d747e1e
Authorization: Bearer <accessToken>
```

Organizer-only. The mirror of §8.2, with the caller and the subject
separated: **`:userId` is the player being removed, and the organizer comes
from the token.** There is no way to act as another organizer.

- **`join` only.** Past that, teams and fixtures reference the roster, so
  pulling a player out would leave a team short and the fixture list wrong
  with no repair step. `400` otherwise — reopen registration first
  (`preparation → join`, see §3.1), remove, then advance again.
- The roster row is **cancelled, not deleted**, exactly like self-leave, so
  it reactivates if that player rejoins.
- `joinedCount` is decremented, guarded so a double-removal cannot drive it
  negative.

| Code | When |
|---|---|
| `400` | Event is past `join` |
| `403` | Caller is not the organizer |
| `404` | Unknown event, **or** that user has not joined |

> Use §8.2 (`DELETE /events/:id/join`) for a player leaving of their own
> accord — that one needs no organizer rights and takes no `:userId`.

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
| **Event-level "make organizer"** | Not built. "Organizer" is *derived* per request — the event's `createdBy`, or an approved `owner`/`admin` of the owning group. There are no per-event roles to grant, so promoting someone for a single event needs a schema change first. |

---

## 10. Gotchas checklist

- [ ] **`status: "open"` and `"full"` are gone.** Match `"join"`, and use `isFull` for capacity.
- [ ] **Removing a player is `join`-only.** `DELETE /events/:id/players/:userId` `400`s past that — reopen registration first (§8.3). Don't show the action on a later stage.
- [ ] **Two different delete routes.** `/join` = the caller leaves; `/players/:userId` = the organizer removes someone. Wiring the organizer button to `/join` removes the organizer.
- [ ] **`preparation → playing` now 409s.** Go `preparation → ready_to_play → playing`. This breaks any existing "start match" button.
- [ ] Handle **`ready_to_play`** in every `switch` on `status` and in the `?status=` filter — an unhandled sixth value is the likely crash.
- [ ] **Shuffling is refused in `ready_to_play`** (`400`). Build the "teams are final" screen read-only, and use `ready_to_play → preparation` if the user needs to change them.
- [ ] `isFull` is **derived**, absent from the stored document — never write it back.
- [ ] **`GET /events` now includes private events you have joined** — check `joinedByMe`; do not assume every row is public. A group's full schedule still needs `GET /events/group/:groupId`.
- [ ] **`GET /events` applies no default date/status filter** — pass `?from=` or `?status=` or archived events appear in a discovery feed.
- [ ] A **pending** group member sees only public events — approval is what unlocks private ones.
- [ ] `409` from `/status` means "illegal transition", `400` means "not a status". Different UX.
- [ ] `done` is terminal: edit, delete, and every transition are refused.
- [ ] Unwrap `data` on success; errors are flat and `message` may be a **list**.
- [ ] `date` is the scheduling field; `startTime`/`endTime` are optional extras.
- [ ] Join failures — "not open" and "full" — are **both** `400`; read the message.
- [ ] Deleting an event is a **hard delete** with no notification to joined players.
- [ ] Teams are a **two-step** flow: `POST /teams/generate` creates them empty, then `PATCH /teams/:teamId` assigns players. Never author `matches[]` client-side.
- [ ] **Match count = `max(roundRobin, slotsInTheBookedTime)`** — a 2-hour event of 10-min matches gives **11** fixtures for 3 teams, not 6. Extra slots repeat the round-robin. **Changed 2026-08-29.**
- [ ] **A short event still overruns** — 3 teams in a 40-min event get all 6 round-robin matches where only 3 fit. The server does not police it; show the total.
- [ ] **`GET /events/:id/payments` is role-aware** — organizers get everyone, a member gets only their own row. A member with **no row** means *unrecorded*, not unpaid (§12).
- [ ] **Payment rows carry no amount.** Compute it from the event: `price + (takeAdditionalPrice ? additionalPrice : 0)`.
- [ ] **Team roles are stored as absence for `player`** — read `team.playerRoles` for captains; anyone in `players` but not in `playerRoles` is a plain player (§11.2c).
- [ ] **`POST /teams/generate` returns only `{ message }`.** Read teams from `GET /events/:id/teams` (you need the ids for §11.2) and fixtures from `GET /events/:id/matches`. `data.teams`/`matches`/`matchCount`/`schedule` are gone.
- [ ] **`POST /teams/generate` now updates `event.teamCount`** to the split it created, so a later `POST /shuffle` (which reads only that field) reproduces it instead of silently rebuilding with the old count.
- [ ] **Send `colors` to name the teams** — one per team, count must equal `teamsCount`, must be distinct (case-insensitively). Spelling is not validated.
- [ ] **`GET /events/joined` never shows a `done` event**, not even with `includeExpired=true`. Use `?status=done` for history.
- [ ] `group.rules` is now a **string, not an array**. Render with `white-space: pre-line`.
- [ ] `GET /events/group/:groupId` **hides expired and `done` events** by default. Pass `includeExpired=true` for history.
- [ ] A **partial roster is legal**. Check `unassignedPlayerIds` in the response and warn the user, or players silently start with no team.
- [ ] Scores are `null` until entered — **not `0`**, which is a real scoreline. Render a dash for `null`.
- [ ] `standings` is derived on every read. Never cache or write it back.
- [ ] **`joinedByMe` is the only field that says whether YOU joined.** `joinedCount` counts everyone; `userRole` is your group role and reads `owner` even for a creator who never joined.
- [ ] Resubmitting teams during `preparation` **regenerates fixtures wholesale**, discarding entered scores.
- [ ] **`GET /events/search` is public-only** — it will not find a group's private event even for a member. Search and "my group's schedule" are different screens.
- [ ] Search with an empty `q` returns an **empty page, not everything**. Don't use it as the browse/listing call.
- [ ] **`GET /events/search` returns `data` as an OBJECT** (`{items, nextCursor, hasMore}`), unlike the other listing routes which return arrays. Read `data.items`.
- [ ] Treat `nextCursor` as **opaque** — round-trip it, never parse or build one. A forged cursor is a `400`.
- [ ] `includeExpired` only accepts the exact string `"true"` — `1`/`yes` are read as false and silently hide past events.

---

## 11. Teams, fixtures and scores

The `preparation`-phase flow, end to end. **The client decides who plays where; the server owns everything derived from that.**

### 11.1 Create the teams — `POST /events/:id/teams/generate`

Teams are created **empty**, together with the full fixture list. Organizer
only, `preparation` only.

> **Changed 2026-08-27 — two breaking changes.** The response is now just a
> success message, and the fixture list is no longer trimmed to the booked
> slot. Details below.

```
POST /events/6a7055f42e55b9cdbe427eb4/teams/generate
{ "teamsCount": 3, "duration": 10, "numberOfPlayers": 8,
  "colors": ["red", "blue", "white"] }
```

| Field | Rule |
|---|---|
| `teamsCount` | 2–6. **Also written to `event.teamCount`** — see below |
| `duration` | Minutes **per match**, ≥ 1. Stored on each team; it no longer bounds the fixture count |
| `numberOfPlayers` | Intended squad size per team, 1–50. Stored on each team as a **target**, not a constraint — see below |
| `colors` | **NEW, optional.** Team names, one per team. Length **must equal `teamsCount`**, and they must be **distinct**. Spelling is **not** validated — any label is accepted. Omit to use the built-in colour vocabulary in order |

**Response — a plain success message:**

```json
{ "data": { "message": "Teams created successfully" } }
```

> ⚠️ **The teams and fixtures are no longer echoed back.** Read them from
> `GET /events/:id/teams` (for the team ids you need in §11.2) and
> `GET /events/:id/matches`. A build reading `data.teams`, `data.matches`,
> `data.matchCount` or `data.schedule` from this call breaks — those fields
> are gone.

**How many matches you get:** enough to **fill the booked slot**, and never
fewer than one full double round-robin.

```
slots       = floor((event.duration - 10) / duration)   ← 10 min buffer
roundRobin  = teamsCount * (teamsCount - 1)             ← every pair, twice
matches     = max(roundRobin, slots)
```

| Event | Match length | Teams | Round-robin | Slots | Matches |
|---|---|---|---|---|---|
| 120 min | 10 min | 3 | 6 | 11 | **11** |
| 90 min | 10 min | 3 | 6 | 8 | **8** |
| 40 min | 10 min | 3 | 6 | 3 | **6** |
| 90 min | 30 min | 4 | 12 | 2 | **12** |

Extra slots **repeat the round-robin from the start** — slot 7 replays the
pairing from slot 1 — so the rotation stays balanced rather than inventing
pairings. `matchNumber` runs contiguously across the whole schedule, so slot 7
is match 7.

> ⚠️ **Changed twice — this is the current behaviour.** The list was originally
> *truncated* to the slot count, which dropped the tail of the schedule. It was
> then changed to the bare round-robin, which left the opposite gap: a two-hour
> event of ten-minute matches has room for 11 and got only 6, leaving an hour of
> pitch time unscheduled. It now fills the slot with the round-robin as a floor.
>
> **The consequence to plan for:** a short event still overruns. 3 teams in a
> 40-minute event get 6 matches — a full round-robin — where only 3 fit. The
> floor wins, because dropping pairings is worse than running long. Show the
> organizer the total and let them shorten `duration` or drop trailing matches.

A `duration` so long that not even one match fits the event is still rejected
with `400`, as a sanity check on the input.

**Colour validation, precisely.** `colors` is checked for **count** and
**distinctness** only:

- `teamsCount: 3` with `["red", "blue"]` → `400` (count mismatch)
- `["red", "blue", "red"]` → `400` (duplicate; comparison is case-insensitive,
  so `Red` and `red` collide)
- `["puce", "not-a-colour", "zzz"]` → **accepted**, spelling is not checked

Distinctness is required because a team's name keys both its fixtures and its
chat room, so two teams sharing a name makes both ambiguous.

**`teamsCount` updates `event.teamCount`.** *(Changed 2026-08-27.)* The event
document now records the split that was actually generated, so
`GET /events/:id` and the teams that exist cannot disagree.

This matters because **`POST /events/:id/shuffle` reads `event.teamCount` and
nothing else** — it takes no body. Before this change, generating 3 teams left
`teamCount` at its old value, so a later shuffle silently rebuilt with a
different count:

```
event created with teamCount 4
POST /teams/generate { teamsCount: 3 }   → 3 teams, teamCount was still 4
POST /shuffle                            → 4 teams   ← surprising
```

Now the second call sets `teamCount` to 3 and the shuffle reproduces the same
split. Nothing is written if the request is rejected — a `400` leaves the event
exactly as it was.

> **The shuffle does NOT write back.** Its team count is capped by the joined
> roster (§11.2b), which is a limit rather than an intent: persisting it would
> pin `teamCount` to 2 forever if only two players had joined at the time.
> `teamCount` therefore only ever changes through `POST /teams/generate`,
> `POST /events` or `PATCH /events/:id`.

**`numberOfPlayers` is a hard upper limit.** Assigning more players than this
to a team is rejected with `400` (§11.2). **Under**-filling stays legal — a
roster is built up incrementally, so "3/5 assigned" is a normal state the client
should render rather than an error.

It is not checked against the joined roster, so 6 joined players with a target
of 11 is accepted at generation time; the limit only binds when players are
actually assigned.

**Re-running replaces everything** — previous teams, fixtures and player
assignments are cleared first. That is the intended way to change the team count
or match length; editing `event.duration` afterwards does **not** re-derive the
schedule on its own.

### 11.2 Assign players — `PATCH /events/:id/teams/:teamId`

Shuffle locally, then assign each team. Replaces that team's roster outright.

```
PATCH /events/6a7055f42e55b9cdbe427eb4/teams/6a70…f1
{ "playerIds": ["665f…a1", "665f…a2"], "name": "Red" }
```

`name` is optional — supply it to rename in the same call.

Rejected with `400` when a `playerId` is not a joined player, appears twice in
the body, is **already in another team** (the message names that team), or when
the roster **exceeds the team's `numberOfPlayers`**. Two teams claiming one
player would corrupt standings and per-player stats; an over-filled team would
field more players than the organizer planned for.

To raise the limit, regenerate the teams with a larger `numberOfPlayers`.

An empty `playerIds` clears the team and returns it to `status: "pending"`.
Assigning players flips it to `"ready"` and notifies each one.

`EventPlayer.team` is kept in step automatically, so player-facing reads stay
consistent with the team documents.

### 11.2c Team roles — `PATCH /events/:id/teams/:teamId/members/:userId/role`

*New 2026-08-29.* Names a captain within a team, once players are assigned.

```http
PATCH /events/6a70…/teams/6a71…/members/6a69…/role
{ "role": "captain" }
```

| Role | Meaning |
|---|---|
| `player` | The default. **Stored as absence** — setting it clears an existing captaincy |
| `captain` | Team captain |

**Who may call it:** the event organizer (owner/admin) **or a group `captain`**.
This is the only team route a captain may use — naming a captain is squad
management, which the role exists for. It grants nothing else: a captain still
cannot edit the event, change its status, or take payments.

- **The player must already be in the team.** Assign them with §11.2 first;
  otherwise `400`. A role on someone outside the squad would be invisible on
  every read and would resurface if they were assigned later.
- **Allowed in every state except `done`.**
- **Roles are dropped automatically** when a player is removed from the team by
  a later §11.2 call — `players` is the source of truth for membership and
  `playerRoles` only annotates it.

**How it is stored.** `team.players` is unchanged — still a flat array of ids,
populated into user objects on read. A parallel `team.playerRoles` array holds
`{ userId, role }` for **non-default roles only**, so a player absent from it is
a plain `player`.

> Reshaping `players` into `[{ userId, role }]` would be the tidier model — one
> source of truth — but it changes the `GET /events/:id/teams` response for
> every existing client, and the assign path, notifications and the shuffle all
> read `players` as ids. Annotating was chosen as the cheaper half of that
> trade. To render a team, read `players` for the squad and check `playerRoles`
> for captaincy.

| Code | When |
|---|---|
| `400` | Malformed ids, the player is not in this team, or the event is `done` |
| `403` | Caller is not owner/admin/captain |
| `404` | That team does not belong to this event |

### 11.2b The server-side fallback — `POST /events/:id/shuffle`

No body. Generates the teams (using `event.teamCount`) and deals the joined
players across them in one call. `numberOfPlayers` is derived as each team's
share of the roster (rounded up), since there is no body to take it from — a convenience wrapper over §11.1 + §11.2 for
callers that want the server to decide. Because it takes no body, it picks a
match duration from the event rather than accepting one.

> **Changed:** this used to assign numeric teams (`"1"`, `"2"`) in buckets of 6.

### 11.3 Fixtures

Generated server-side as a **full double round-robin** — every pair twice, home
and away. 4 teams is 12 fixtures, and all 12 are created.

> **Changed 2026-08-27:** the list used to be truncated to
> `floor((event.duration - 10) / duration)` matches, so a 90-minute event with
> 30-minute matches kept only the first 2 of 12. That truncation is gone —
> `GET /events/:id/matches` now returns the whole schedule (§11.1).

Leg 1 is emitted in full before leg 2, so every team meets a different opponent
before anyone plays a rematch. `matchNumber` runs contiguously from 1.

Fixtures are **never client-authored**. You cannot send `matches[]`; a stale app therefore cannot persist a divergent fixture format.

Each fixture is a document in its own collection with a stable `_id`, so it can be referenced from elsewhere — player ratings (§8) attach to a specific match. `GET /events/:id` still returns them inline as `matches` for convenience, so the response shape you consume is unchanged.

Resubmitting during `preparation` regenerates teams and fixtures wholesale. Once the event leaves `preparation` they are locked.

### 11.3b Add a fixture by hand — `POST /events/:id/matches`

An escape hatch for schedules the generator cannot express — an extra decider,
a re-run of a washed-out fixture, or any pairing outside the round-robin. Since
2026-08-27 the generated schedule is complete, so this is no longer needed to
patch a truncated list.

```
POST /events/6a7055f42e55b9cdbe427eb4/matches
{ "teamA": "Blue", "teamB": "Red" }
```

Organizer only. Both names must belong to this event (case-insensitive; the
stored casing is used). Created **unplayed** — score it with `PATCH` like any
other fixture.

`matchNumber` is **not** accepted: it is uniquely indexed per event, so the
server appends after the current highest rather than letting a caller pick a
number they cannot see.

**What it deliberately does NOT do**, by decision:

- **No round-robin check.** `matches[]` may stop forming a valid double
  round-robin. Standings still compute correctly — the fold is defined over the
  fixtures as stored, whatever they are.
- **No duration budget check.** Scheduled minutes may exceed what
  `event.duration` allows.
- **No renumbering** of existing fixtures.
- **No lifecycle gate** — allowed in any state, since an organizer may need it
  late.

> ⚠️ **Add AFTER generating, not before.** `POST /teams/generate` and
> `POST /shuffle` both replace the fixture list wholesale, so a hand-added
> match is lost.

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

---

## 12. Member payments

*New 2026-08-29.* Records **whether** each member has paid — not how much.

### 12.1 What an event costs

The amount lives on the **event**, not on the payment row:

```
total = price + (takeAdditionalPrice ? additionalPrice : 0)
```

Both `additionalPrice` and `takeAdditionalPrice` are settable at
`POST /events` and via `PATCH /events/:id`. The surcharge amount and whether it
applies are separate fields on purpose, so an organizer can keep a configured
surcharge and switch it off between events without retyping it.

> **No amount is stored per member.** Copying the price onto each payment row
> would drift the moment an organizer edited the event. The row answers one
> question: has this member paid? Compute the amount client-side from the event.

### 12.2 `GET /events/:id/payments`

**Role-aware, one route:**

| Caller | Sees |
|---|---|
| Organizer (owner/admin) | Every member's row — this is the "Manage Payments" screen |
| Anyone else | **Only their own row** |

A member has no business reading who else has paid, hence the narrowing.

```json
{
  "data": [
    {
      "_id": "…",
      "eventId": "…",
      "memberId": { "_id": "…", "name": "Thant", "username": "thant",
                    "displayName": "Thant", "profileImage": "https://…" },
      "isPaid": true,
      "paidAt": "2026-08-29T09:12:00.000Z",
      "recordedBy": "…"
    }
  ]
}
```

> **A member with no row is ABSENT, not returned as unpaid.** That means "not
> recorded yet", which is deliberately distinct from "recorded as unpaid". Join
> against `GET /events/:id/players` for the roster and treat a missing row as
> *unrecorded* in the UI.

`memberId` is populated with display fields only — **never the email**, matching
`/users/search` and `/groups/:id/members`.

### 12.3 `PATCH /events/:id/payments/:memberId`

Organizer only.

```http
PATCH /events/6a70…/payments/6a69…
{ "isPaid": true }
```

- **Upserts** — the first call for a member creates their record, so there is no
  separate "open the payment sheet" step.
- The member must be **on the roster** (`status: joined`), else `404`.
- `paidAt` is stamped when `isPaid` becomes true and **cleared when a payment is
  reversed**, so it can never read as a payment date for someone currently
  unpaid.
- `recordedBy` captures which organizer marked it — payments are *recorded*
  here, not taken. No money moves through this API.

| Code | When |
|---|---|
| `400` | Malformed `memberId` |
| `403` | Caller is not the organizer |
| `404` | Unknown event, or that member has not joined |

> **Guest players are not covered yet.** The `+1`/`+2` flow is unbuilt (§9), so
> a guest has no user id and therefore cannot hold a payment row. Once guests
> exist, `memberId` will need to accept them or the schema will need a guest
> reference.
