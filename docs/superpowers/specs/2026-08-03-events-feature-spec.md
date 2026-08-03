# Events Feature — Design Spec (§4.5, §4.6)

**Date:** 2026-08-03
**Author:** Backend team
**Parent spec:** [2026-07-28-kickr-spec-v2-changes.md](./2026-07-28-kickr-spec-v2-changes.md) §5
**Supersedes:** [2026-07-23-event-lifecycle-rework.md](../plans/2026-07-23-event-lifecycle-rework.md) — that plan predates the v3 spec (it assumes local-disk uploads and has no multi-team fixtures). Its transition table and task shape are reused below; its stale parts are corrected.
**Stack:** NestJS 11 · MongoDB (Mongoose) · ImageKit · Socket.io · AWS Cognito

---

## 1. Goal

Take Events from the current capacity-only model to the full spec behaviour:

1. **Lifecycle** — replace `open|full|done` with the 6-state match lifecycle; capacity becomes derived.
2. **Multi-team fixtures** — an event holds N colour teams playing a double round-robin, each fixture independently scored, standings derived on read.
3. **After-match** — MVP, cover image, photos (ImageKit), start/end times.
4. **Discovery & templates** — geo search via `Location.geo`, reusable event templates, likes.

Out of scope: player ratings (§8, separate module — this spec only guarantees the `after_match` state exists for it to hang off), tournaments (§6), challenges (§10).

---

## 2. Current state — VERIFIED against `src/` on `main`

`src/events/schemas/event.schema.ts`:
`title, description, date, groupId, isPublic, createdBy, locationId, maxPlayers, joinedCount, sportType, skillLevel, price, status('open'|'full'|'done')` + timestamps. Indexes on `{groupId,date}`, `{isPublic,date}`, `{createdBy,date}`.

`EventPlayer`: `eventId, userId, joinedAt, team, position, status('joined'|'cancelled'), checkInTime`. Unique compound `{eventId,userId}`.

`EventsService` has `list, create, findById, join, leave, listPlayers`. `join` does an atomic capacity check via `findOneAndUpdate` with `$expr: {$lt:['$joinedCount','$maxPlayers']}`, then flips `status` to `full` at capacity; `leave` reverses it with an update pipeline.

`ShuffleService` chunks joined players into random buckets of 6, names teams `"1"`, `"2"`…, notifies each player, and is **not** gated on event status.

> **Correction to the parent spec (§5.4):** `locationId` is **already** on the Event schema and `CreateEventDto` — the §3 location migration landed. The flat `locationName/latitude/longitude` fields are gone. §5.4's "REPLACES locationName/latitude/longitude" line is already satisfied; nothing to migrate there.

> **Correction to the parent spec (§3.3):** locations are no longer purely creator-owned — `Location` gained a nullable `groupId`, and `LocationsService` exposes `assertCanEdit` / `assertCanDelete` which also permit the owning group's owner/admin/captain. `EventsService.create` currently calls the stricter `assertOwnedBy`; see §4.6 below.

---

## 3. Locked decisions

| # | Question | Decision |
|---|---|---|
| 1 | Transitions | Manual, organizer-gated `PATCH /events/:id/status`, validated against a legal-transition table. No scheduler. |
| 2 | Shuffle strategy (parent §14 #6) | **Fixed N colour teams.** Players split into N teams named Red/Yellow/Blue/Black/Green/Orange. `teamCount` configurable per event, default 4. |
| 3 | Fixture format | **Generic double round-robin** for any N: every pairing played twice. N=4→12 matches, N=3→6, N=2→2. One algorithm, no special cases. |
| 4 | Score authority | For multi-team events `matches[]` is the sole source of truth. `Event.result` carries `mvpUserId` (+ optional overall score for simple 2-team events). |
| 5 | Standings | **Derived on read**, never stored. Win 3 / draw 1 / loss 0. |
| 6 | Uploads | ImageKit via the existing `ImageKitService`, mirroring the group logo/wallpaper routes. |

---

## 4. Design

### 4.1 Lifecycle

```
join → before_match → preparation → playing → after_match → done
```

| From | To (allowed) |
|---|---|
| `join` | `before_match` |
| `before_match` | `preparation`, `join` (reopen registration) |
| `preparation` | `playing`, `before_match` (revert) |
| `playing` | `after_match` |
| `after_match` | `done` |
| `done` | — terminal |

Action gates:

| Action | Allowed when |
|---|---|
| join | `status == 'join'` **and** `joinedCount < maxPlayers` |
| unjoin (leave) | `status == 'join'` |
| shuffle / generate fixtures | `status == 'preparation'` |
| enter fixture score | `status` in `playing`, `after_match` |
| submit result / MVP / photos | `status == 'after_match'` |
| edit / delete event | organizer, any non-`done` state |

Capacity is derived: `isFull = joinedCount >= maxPlayers`, exposed as a computed field on reads. There is no `full` status.

On entering `done`: archive the event's team chats.

**Organizer** = the event's `createdBy`, or — for group events — an approved `owner`/`admin` of `event.groupId`. This mirrors the existing check in `ShuffleService.shuffle` and should be extracted into one shared helper rather than duplicated a third time.

### 4.2 Migration from the current status values

`open → join`, `full → join` (capacity now derived, so a full event is still logically in registration), `done → done`. A one-off script under `scripts/` handles existing rows; the schema default becomes `'join'`.

### 4.3 Teams & fixtures

Shuffle assigns each joined player a colour team:

```
TEAM_COLOURS = ['Red', 'Yellow', 'Blue', 'Black', 'Green', 'Orange']
```

Fisher-Yates the joined players, then deal them round-robin across the first `teamCount` colours so team sizes differ by at most one. `teamCount` is an Event field (default 4, min 2, max 6).

Fixtures are then generated as a **double round-robin** over the teams actually used:

```
for each unordered pair (i, j): emit (i, j) in leg 1, then (j, i) in leg 2
matchNumber is assigned 1..N sequentially across leg 1 then leg 2
```

For 4 teams this yields 12 matches with each team playing 6 — matching the parent spec's fixture table. Leg 2 swaps home/away so the repeated pairing isn't a literal duplicate row.

**Rules:**
1. Generated **once**, on shuffle during `preparation`. Immutable afterward except score entry.
2. Re-shuffling while still in `preparation` regenerates teams **and** fixtures, discarding any scores entered (there should be none yet — scores need `playing`).
3. Scores stay `null` until entered; the UI renders a dash.

**Standings** are computed on read from `matches[]`: played, W, D, L, GF, GA, GD, points (3/1/0). Sorted by points, then GD, then GF, then team name for determinism. Matches with a `null` score on either side are skipped.

### 4.4 Schema changes

**`Event`** — add:

```
status: enum join|before_match|preparation|playing|after_match|done   // default 'join', REPLACES open|full|done
startTime: Date | null          // spec separates match Date + Time
endTime: Date | null
teamCount: number               // default 4, min 2, max 6
coverImage: string | null
coverImageFileId: string | null // ImageKit fileId, for replace/delete
photos: [{ url: string, fileId: string }]   // after-match photos
result: {
  mvpUserId: ObjectId->User | null
  scoreA: number | null         // simple 2-team events only
  scoreB: number | null
} | null
matches: [EventMatch]           // embedded, see below
templateId: ObjectId->EventTemplate | null
likeCount: number               // default 0, denormalised
```

> `photos` stores `{url, fileId}` objects rather than the parent spec's bare `[string]`, because deleting a photo from ImageKit needs its `fileId`. Same reasoning already applied to avatars and group logos.

**`EventMatch`** (embedded sub-document, no `_id`):

```
matchNumber: number       // 1..N, fixed order
teamA: string             // colour name
teamB: string
scoreA: number | null
scoreB: number | null
playedAt: Date | null
```

**`EventLike`** (new collection) — `{ eventId, userId, createdAt }`, unique compound `{eventId,userId}`. A separate collection rather than an array on Event so the like list doesn't grow the event document unboundedly and "did I like this" is an indexed lookup. `Event.likeCount` is the denormalised counter.

**`EventTeamChat`** (new collection) — `{ eventId, team, archived, createdAt }`, unique compound `{eventId,team}`. Created on shuffle, `archived: true` on `done`. This scaffolds the rooms only; full real-time event chat is follow-up work.

**`EventTemplate`** (new collection):

```
{
  name: string                  // required — how the template shows in a picker
  ownerId: ObjectId->User       // required
  groupId: ObjectId->Group | null
  title, description: string
  locationId: ObjectId->Location | null
  maxPlayers, teamCount, price: number
  sportType, skillLevel: string
  createdAt / updatedAt
}
```

`POST /events` accepts an optional `templateId`: template values fill any field the request omits; explicit request fields always win. The resulting event stores `templateId` for provenance.

**New indexes:** `{status: 1, date: 1}` for lifecycle-filtered listing; `EventLike {eventId, userId}` unique; `EventTeamChat {eventId, team}` unique; `EventTemplate {ownerId, createdAt}`.

### 4.5 Geo discovery

`GET /events?near=<lat>,<lng>&radius=<metres>` resolves through `locationId` — `Location.geo` already carries a `2dsphere` index. Implemented as an aggregation: `$geoNear` on `locations` → `$lookup` the events referencing those locations → filter `isPublic: true` and `status: 'join'` → sort by distance. Returns each event with a `distance` field in metres.

Combines with the existing filters (`groupId`, date range). Radius defaults to 10 000 m, capped at 100 000 m.

> Per parent §3, the same physical pitch may exist as several rows (one per creator/group), so nearby results can contain apparent duplicates. That is accepted behaviour, not a defect.

### 4.6 Location attach permission

`EventsService.create` currently calls `locationsService.assertOwnedBy`, which rejects a group's own location unless the caller personally created it — so a group admin can't attach their group's home ground to a group event. Switch event location attach to `assertCanEdit`, which allows the creator *or* the owning group's owner/admin/captain. This aligns events with how groups already treat their locations.

### 4.7 Uploads

Cover image and after-match photos follow the established group-logo pattern: `FileInterceptor` + `multerMemoryImageOptions` → `ImageKitService.upload(buffer, fileName, folder)` → store `{url, fileId}` → best-effort `deleteFile` of the previous file on replace. Folders: `events/covers`, `events/photos`.

No video upload is needed for this spec, so `multerMemoryVideoOptions` (parent §9.3) is **not** built here — it belongs with highlight videos and chat attachments.

---

## 5. Scenario design

End-to-end flows for the journeys this spec introduces. Same convention as the parent spec's §13: **where a diagram and the prose in §4 disagree, §4 is authoritative** — the diagrams are a reading aid, not a second source of truth.

Diagrams cover the failure paths as well as the happy ones, because most of the behaviour being added here *is* gate enforcement.

### 5.1 Full event lifecycle — state machine

The 6 states from §4.1, with the actions each one permits. Capacity is derived, so a full event stays in `join`.

📊 **Diagram:** [`events-5-1-event-lifecycle-states.mmd`](../diagrams/events-5-1-event-lifecycle-states.mmd) — mermaid source (GitHub renders it on open).

### 5.2 Organizer happy path — create to archive

The whole journey in one pass, 4 colour teams. Note where each of the four build-order steps contributes.

📊 **Diagram:** [`events-5-2-organizer-happy-path.mmd`](../diagrams/events-5-2-organizer-happy-path.mmd) — mermaid source (GitHub renders it on open).

### 5.3 Join / unjoin gating

Two independent guards: the lifecycle state, and the atomic capacity check. The capacity check is the existing `findOneAndUpdate` + `$expr` — only its status condition changes (`open` → `join`).

📊 **Diagram:** [`events-5-3-join-unjoin-gating.mmd`](../diagrams/events-5-3-join-unjoin-gating.mmd) — mermaid source (GitHub renders it on open).

### 5.4 Shuffle → colour teams → fixture generation

The `preparation`-only operation. Re-running it inside `preparation` is legal and regenerates everything.

📊 **Diagram:** [`events-5-4-shuffle-colour-teams-fixtures.mmd`](../diagrams/events-5-4-shuffle-colour-teams-fixtures.mmd) — mermaid source (GitHub renders it on open).

### 5.5 Score entry & standings

Standings are never stored. Every read recomputes from `matches[]`, skipping fixtures with a `null` score.

📊 **Diagram:** [`events-5-5-score-entry-standings.mmd`](../diagrams/events-5-5-score-entry-standings.mmd) — mermaid source (GitHub renders it on open).

### 5.6 Geo discovery

`$geoNear` must be the first aggregation stage, so the pipeline starts from `locations` and looks *up* to events — not the reverse.

📊 **Diagram:** [`events-5-6-geo-discovery.mmd`](../diagrams/events-5-6-geo-discovery.mmd) — mermaid source (GitHub renders it on open).

### 5.7 Illegal transition — the rejection path

Every `PATCH /status` goes through the pure transition table. This is the single most-exercised guard in the spec, so it gets its own flow.

📊 **Diagram:** [`events-5-7-illegal-transition.mmd`](../diagrams/events-5-7-illegal-transition.mmd) — mermaid source (GitHub renders it on open).

---

## 6. API surface

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/events` | any | **CHANGED** — filters: `groupId`, `status`, `near=lat,lng`, `radius`, `from`/`to` |
| POST | `/events` | organizer | **CHANGED** — accepts `startTime`, `endTime`, `teamCount`, `templateId` |
| GET | `/events/:id` | any | **CHANGED** — includes `isFull`, `standings`, `likedByMe` |
| PATCH | `/events/:id` | organizer | **NEW** — edit; rejected when `done` |
| DELETE | `/events/:id` | organizer | **NEW** — cancel/delete |
| PATCH | `/events/:id/status` | organizer | **NEW** — advance lifecycle, validated against the table |
| POST | `/events/:id/join` | member | **CHANGED** — gated to `join` state |
| DELETE | `/events/:id/join` | member | **CHANGED** — gated to `join` state |
| GET | `/events/:id/players` | any | unchanged |
| POST | `/events/:id/shuffle` | organizer | **CHANGED** — gated to `preparation`; colour teams; generates fixtures; creates team chats |
| GET | `/events/:id/matches` | any | **NEW** — fixture list |
| PATCH | `/events/:id/matches/:matchNumber` | organizer | **NEW** — enter a fixture score |
| GET | `/events/:id/standings` | any | **NEW** — derived table |
| POST | `/events/:id/result` | organizer | **NEW** — MVP (+ optional overall score) |
| POST | `/events/:id/cover` | organizer | **NEW** — ImageKit |
| POST | `/events/:id/photos` | organizer | **NEW** — ImageKit, `after_match` only |
| DELETE | `/events/:id/photos/:fileId` | organizer | **NEW** — remove a photo |
| POST | `/events/:id/like` | any | **NEW** — idempotent like |
| DELETE | `/events/:id/like` | any | **NEW** — unlike |
| GET | `/event-templates` | owner | **NEW** — caller's templates |
| POST | `/event-templates` | owner | **NEW** |
| DELETE | `/event-templates/:id` | owner | **NEW** |

Error contract: `403` wrong actor, `404` unknown event/match, `409` illegal transition or duplicate join, `400` validation and gate violations (e.g. scoring a fixture before `playing`).

---

## 7. Build order

Each step is independently shippable and leaves the suite green.

1. **Lifecycle core** — `events.lifecycle.ts` (pure transition table + `canTransition`), status enum migration, re-gate join/leave, `PATCH /events/:id/status`, shared organizer helper, `PATCH`/`DELETE /events/:id`. Migration script for existing rows.
2. **Teams & fixtures** — colour-team shuffle gated to `preparation`, generic double round-robin generation, `matches[]`, score entry, standings-on-read, `EventTeamChat` scaffold + archive on `done`.
3. **After-match** — `result`/MVP, cover + photos via ImageKit, `startTime`/`endTime`.
4. **Discovery & templates** — `$geoNear` listing, `EventTemplate` collection and routes, likes.

Steps 1 and 2 are the load-bearing ones — ratings (§8) and the profile stats currently stubbed at 0 (parent §2.3) both unblock once `after_match` and MVP exist.

---

## 8. Testing

Follows the repo's existing pattern (`*.spec.ts` beside the source, `test/` for e2e).

- **Pure units** — transition table (every legal and illegal pair), fixture generation (N=2..6: correct match count, equal matches per team, every pairing exactly twice, home/away swapped in leg 2), standings computation (3/1/0, draws, null-score matches skipped, tie-break ordering).
- **Service** — join/leave gate rejection per state; shuffle rejected outside `preparation`; score entry rejected before `playing`; MVP must be a joined player; re-shuffle regenerates fixtures; like idempotency.
- **Schema** — defaults, enums, index declarations.
- **e2e** — full walkthrough: create → join to capacity → advance to `preparation` → shuffle → verify 12 fixtures for 4 teams → `playing` → score every fixture → standings correct → `after_match` → MVP + photo → `done` → team chats archived.

---

## 9. Risks & open questions

| Risk | Mitigation |
|---|---|
| Status migration breaks live clients expecting `open`/`full` | Ship the migration script with step 1; the Flutter client must land the new enum in the same release. **Coordinate before merging.** |
| `joinedCount` drift under concurrent joins | Keep the existing atomic `findOneAndUpdate` + `$expr` guard; only the status condition changes (`open` → `join`). |
| Re-shuffle silently discarding scores | Scores can't exist in `preparation` (entry needs `playing`), so the window is closed by the gate rather than by a check. |
| `$geoNear` must be the first aggregation stage | Start from `locations` and `$lookup` events, not the reverse. |

**Open, needs product input — none of these block step 1:**

1. **Deleting an event with joined players** — hard delete, or soft `cancelled` flag with notifications to players? Currently assumed hard delete for `join`-state events only.
2. **Who enters fixture scores** — organizer only (assumed), or any joined player / a designated team captain?
3. **`before_match` reopen** — the table allows `before_match → join`. Should reopening be blocked once teams have been shuffled? (Currently unreachable: shuffle needs `preparation`, and `preparation → join` isn't legal.)
4. **Parent §14 #6 formally resolved** — this spec locks colour teams; the parent doc should be updated to mark it RESOLVED.
