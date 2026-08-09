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

`ShuffleService` chunks joined players into random buckets of 6, names teams `"1"`, `"2"`…, notifies each player, and is **not** gated on event status. Per decision #7 this server-side shuffling is **removed**, not extended: the service keeps the organizer check, the notification fan-out, and gains the `preparation` gate, but the Fisher-Yates bucketing goes away in favour of persisting the client's assignment.

> **Correction to the parent spec (§5.4):** `locationId` is **already** on the Event schema and `CreateEventDto` — the §3 location migration landed. The flat `locationName/latitude/longitude` fields are gone. §5.4's "REPLACES locationName/latitude/longitude" line is already satisfied; nothing to migrate there.

> **Correction to the parent spec (§3.3):** locations are no longer purely creator-owned — `Location` gained a nullable `groupId`, and `LocationsService` exposes `assertCanEdit` / `assertCanDelete` which also permit the owning group's owner/admin/captain. `EventsService.create` currently calls the stricter `assertOwnedBy`; see §4.6 below.

---

## 3. Locked decisions

| # | Question | Decision |
|---|---|---|
| 1 | Transitions | Manual, organizer-gated `PATCH /events/:id/status`, validated against a legal-transition table. No scheduler. |
| 2 | Who shuffles (parent §14 #6) | **The client (mobile).** It submits a finalized team list via `PUT /events/:id/teams`; the server validates and derives fixtures/chats/notifications (§4.3). A server-side colour-team shuffle is kept as an optional fallback. Colours are Red/Yellow/Blue/Black/Green/Orange, `teamCount` configurable per event, default 4. *(Revises parent §14 #6.)* |
| 3 | Fixture format | **Generic double round-robin** for any N: every pairing played twice. N=4→12 matches, N=3→6, N=2→2. One algorithm, no special cases — generated server-side from the finalized teams. |
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
| submit teams / shuffle / generate fixtures | `status == 'preparation'` |
| enter fixture score | `status` in `playing`, `after_match` |
| submit result / MVP / photos | `status == 'after_match'` |
| edit / delete event | organizer, any non-`done` state |

Capacity is derived: `isFull = joinedCount >= maxPlayers`, exposed as a computed field on reads. There is no `full` status.

On entering `done`: archive the event's team chats.

**Organizer** = the event's `createdBy`, or — for group events — an approved `owner`/`admin` of `event.groupId`. This mirrors the existing check in `ShuffleService.shuffle` and should be extracted into one shared helper rather than duplicated a third time.

### 4.2 Migration from the current status values

`open → join`, `full → join` (capacity now derived, so a full event is still logically in registration), `done → done`. A one-off script under `scripts/` handles existing rows; the schema default becomes `'join'`.

### 4.3 Teams & fixtures

> **REVISED 2026-08-06 — the client now performs the shuffle.** The mobile app decides team assignment and submits the finalized list; the server no longer chooses who goes where by default. It validates the submission, persists it, and derives everything downstream. The server-side shuffle is **kept as an optional fallback** (§4.3.3).

#### 4.3.1 Submitting teams — `PUT /events/:id/teams`

The client sends the finalized roster:

```json
{
  "teams": [
    { "name": "Red",    "playerIds": ["665f…a1", "665f…a2"] },
    { "name": "Yellow", "playerIds": ["665f…a3", "665f…a4"] }
  ]
}
```

**Why `PUT` and not `POST`:** the call replaces the entire assignment rather than adding to it. Resubmitting is idempotent — the same body twice leaves the same state.

A client-supplied roster is **untrusted input**. The server rejects with `400` unless all of the following hold:

| Rule | Why |
|---|---|
| Every `playerId` is a **joined** player on this event | Stops stale, fabricated, or cancelled-player ids landing on a team |
| No player appears in **two teams** | Would corrupt standings and per-player stats |
| No duplicate id **within** a team | Same |
| Team `name`s are unique and non-empty | `name` keys the fixtures and team chats |
| At least **2** teams, at most **6** | Fixture generation needs ≥2; the cap matches `teamCount` |
| Caller is the organizer, `status == 'preparation'` | Same gate as everything else in this phase |

Errors name the offending ids (e.g. `Player 665f…a3 appears in both Red and Yellow`) — a bare "invalid teams" is unactionable from a mobile client.

**Partial assignment is allowed.** Joined players absent from the submission keep `team: null`. This supports reserves and late arrivals, and the client may add them in a later resubmission.

> ⚠️ **Consequence:** a client bug that omits players will silently leave them off every team rather than erroring. The response therefore returns `unassignedPlayerIds` so the app can surface "3 players not on a team" instead of discovering it at kick-off. Consider warning the user client-side before submitting a partial roster.

`teamCount` remains an Event field but becomes **advisory** — a hint for the client's UI, not a constraint the server enforces against the submitted list. The authoritative team count is `teams.length`.

#### 4.3.2 What the server still owns

Team *assignment* moved to the client. Everything derived from it did **not** — these stay server-side because they must be consistent and are not the client's to author:

1. **Persisting `EventPlayer.team`** — one `bulkWrite`, plus clearing `team` on any player dropped from the roster.
2. **Fixture generation** — deterministic from the team list (§4.3.4). The client never authors match records.
3. **Team chat rooms** — one `EventTeamChat` per team name.
4. **Notifications** — each player told their team.

#### 4.3.3 Server-side shuffle — kept as a fallback

`POST /events/:id/shuffle` is **retained**. It assigns colour teams server-side, then routes through the *same* persistence path as a client submission, so there is one write path and one set of downstream effects.

The colour vocabulary both the client and the fallback draw from:

```
TEAM_COLOURS = ['Red', 'Yellow', 'Blue', 'Black', 'Green', 'Orange']
```

Fisher-Yates the joined players, then deal them round-robin across the first `teamCount` colours so team sizes differ by at most one.

Useful for a web client, an organizer who wants the server to decide, and as a fallback if the mobile shuffle ships late. **Both endpoints write the same fields; whichever ran last wins.** Neither is privileged.

#### 4.3.4 Fixture generation

Fixtures are generated from the finalized teams — **whatever their source** — as a **double round-robin**:

```
for each unordered pair (i, j): emit (i, j) in leg 1, then (j, i) in leg 2
matchNumber is assigned 1..N sequentially across leg 1 then leg 2
```

For 4 teams that is 12 matches with each team playing 6, matching the parent spec's fixture table. Leg 2 swaps home/away so the repeated pairing isn't a literal duplicate row.

**Stored shape** — `matches[]` is derived, never client-authored:

```
matches: [{ matchNumber, teamA, teamB, scoreA: null, scoreB: null, playedAt: null }]
```

**Rules:**
1. Generated on every teams submission during `preparation` — from `PUT /teams` or `POST /shuffle` alike.
2. **Resubmitting while still in `preparation` regenerates teams *and* fixtures**, discarding any scores entered (there should be none — scores need `playing`).
3. Teams and fixtures lock once the event leaves `preparation`. `PUT /teams` outside that state → `400`.
4. Scores stay `null` until entered; the UI renders a dash. They are set only via `PATCH /events/:id/matches/:matchNumber` — a fixture score in a teams submission is ignored.
5. Teams named in `matches[]` are the submitted names, so **renaming a team means resubmitting** — there is no rename-in-place.

> **Two clients on different app versions:** because fixtures are generated server-side from the submitted team list, a stale client cannot persist a divergent fixture format — the only client-authored data is the roster in §4.3.1, and that is validated. This is the main practical gain over a pure-persist endpoint.

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

### 5.4 Team submission → validation → fixture generation

The `preparation`-only operation. Both entry points — the client's `PUT /teams` and the fallback `POST /shuffle` — converge on one persistence path, so fixtures, team chats and notifications behave identically whichever ran. Re-running inside `preparation` is legal and regenerates everything.

📊 **Diagram:** [`events-5-4-team-submission-fixtures.mmd`](../diagrams/events-5-4-team-submission-fixtures.mmd) — mermaid source (GitHub renders it on open).

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
| PUT | `/events/:id/teams` | organizer | **NEW** — client submits the finalized team list (§4.3.1); validates, persists, generates fixtures + team chats, notifies |
| POST | `/events/:id/shuffle` | organizer | **CHANGED** — gated to `preparation`; optional server-side fallback (§4.3.3); same write path as `PUT /teams` |
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

> **Status 2026-08-09 — all four steps implemented.** 501 tests across 32 suites,
> `nest build` clean, and the §8 walkthrough verified end to end against a real
> MongoDB. `POST /shuffle` now delegates to the same write path as
> `PUT /teams` rather than keeping its old numeric-bucket implementation.
> Remaining gaps are listed in §9 and in the API doc's "not built yet" table:
> team-chat *messaging* (the rooms exist and archive, but there is no send/read
> endpoint), and player ratings (§8, a separate module).

Each step is independently shippable and leaves the suite green.

1. **Lifecycle core** — `events.lifecycle.ts` (pure transition table + `canTransition`), status enum migration, re-gate join/leave, `PATCH /events/:id/status`, shared organizer helper, `PATCH`/`DELETE /events/:id`. Migration script for existing rows.

   **Schema ownership:** step 1 also lands the §4.4 *fields* that later steps fill — `matches: []`, `result: null`, `startTime`/`endTime`, `teamCount`, `coverImage`, `photos`, `likeCount`. They ship empty and unused. This is deliberate: the status migration already rewrites every event document, so adding the columns in the same pass avoids a second migration, and it means steps 2–3 are pure service/controller work with no schema change. Do **not** read step 1's schema as implying the behaviour is present.
2. **Teams & fixtures** — `PUT /events/:id/teams` with full validation, shared persistence path, generic double round-robin generation, `matches[]`, score entry, standings-on-read, `EventTeamChat` scaffold + archive on `done`. Retain `POST /shuffle` on the same path, gated to `preparation`. Depends on step 1 for both the `matches[]` field and the `playing` state that gates score entry — the dependency runs one way, so step 1 never waits on this.
3. **After-match** — `result`/MVP, cover + photos via ImageKit, `startTime`/`endTime`.
4. **Discovery & templates** — `$geoNear` listing, `EventTemplate` collection and routes, likes.

Steps 1 and 2 are the load-bearing ones — ratings (§8) and the profile stats currently stubbed at 0 (parent §2.3) both unblock once `after_match` and MVP exist.

---

## 8. Testing

Follows the repo's existing pattern (`*.spec.ts` beside the source, `test/` for e2e).

- **Pure units** — transition table (every legal and illegal pair), fixture generation (N=2..6: correct match count, equal matches per team, every pairing exactly twice, home/away swapped in leg 2), standings computation (3/1/0, draws, null-score matches skipped, tie-break ordering).
- **Service** — join/leave gate rejection per state; teams submission and shuffle rejected outside `preparation`; score entry rejected before `playing`; MVP must be a joined player; resubmission regenerates fixtures; submitted scores are ignored and stored `null`; like idempotency.
- **Teams validation** — each rejection rule in §4.3.1 (non-joined id, player in two teams, duplicate within a team, duplicate/empty name, <2 or >6 teams), each naming the offending id; partial roster accepted with the right `unassignedPlayerIds`; a player dropped on resubmission has `team` cleared; `PUT` is idempotent for the same body.
- **Schema** — defaults, enums, index declarations.
- **e2e** — full walkthrough: create → join to capacity → advance to `preparation` → `PUT /teams` with 4 teams → verify 12 fixtures → `playing` → score every fixture → standings correct → `after_match` → MVP + photo → `done` → team chats archived. Plus one pass using `POST /shuffle` instead, asserting it lands in the same state.
- **Deliberately not tested** — team *balance* beyond the §4.3.1 rules. Partial rosters are legal by decision (§4.3.1), so a test asserting every joined player has a team would encode a guarantee the spec does not make; `unassignedPlayerIds` is asserted instead.

---

## 9. Risks & open questions

| Risk | Mitigation |
|---|---|
| Status migration breaks live clients expecting `open`/`full` | Ship the migration script with step 1; the Flutter client must land the new enum in the same release. **Coordinate before merging.** |
| `joinedCount` drift under concurrent joins | Keep the existing atomic `findOneAndUpdate` + `$expr` guard; only the status condition changes (`open` → `join`). |
| Re-submitting teams silently discarding scores | Scores can't exist in `preparation` (entry needs `playing`), so the window is closed by the gate rather than by a check. |
| Client omits players from the roster | Allowed by decision, so the server can't reject it. Mitigated by returning `unassignedPlayerIds` so the app can warn rather than fail silently at kick-off. |
| Client and server shuffle disagree about state | Both write via one shared path (§4.3.2); last write wins. Neither endpoint is privileged. |
| Client sends a malformed roster | Rejected at the boundary by the §4.3.1 rules, with the offending ids named. The cases that would corrupt standings or per-player stats — duplicate, cancelled, or fabricated ids — cannot be persisted. |
| Two clients on different app versions submit different fixture formats | Not reachable: fixtures are generated server-side (§4.3.4), so `matches[]` has exactly one producer. Only the roster is client-authored, and it is validated. |
| `$geoNear` must be the first aggregation stage | Start from `locations` and `$lookup` events, not the reverse. |

**Open, needs product input — none of these block step 1:**

1. **Deleting an event with joined players** — hard delete, or soft `cancelled` flag with notifications to players? Currently assumed hard delete for `join`-state events only.
2. **Who enters fixture scores** — organizer only (assumed), or any joined player / a designated team captain?
3. **`before_match` reopen** — the table allows `before_match → join`. Should reopening be blocked once teams have been shuffled? (Currently unreachable: shuffle needs `preparation`, and `preparation → join` isn't legal.)
4. **Parent §14 #6 formally resolved** — this spec locks colour teams; the parent doc should be updated to mark it RESOLVED.
