# KickR Backend — Spec v2 Changes (Gap Analysis & Change Spec) — v3

**Date:** 2026-07-28
**Supersedes:** [2026-07-24-kickr-spec-v2-changes.md](./2026-07-24-kickr-spec-v2-changes.md) (and the original 2026-07-22 version)
**Author:** Backend team
**Baseline:** [2026-06-20 KickR Backend Phase 1 Design Spec](./2026-06-20-kickr-backend-design.md)
**Drivers:** `kickr-spec-v2.pdf` + Flutter reference screenshots (`screenshots/*.png`)
**Stack:** NestJS · MongoDB (Mongoose) · Socket.io · **AWS Cognito** (auth) · **ImageKit** (file storage/CDN)

> **What changed in v3:** all "current state" sections re-verified against source on `main` (the previous version described pre-Cognito code that no longer exists); obsolete email-verification section removed; a new **`Location` collection** (§3, owned by its creator) replaces the three conflicting location models; contradictions in the group/fixture sections resolved.
>
> **Status refresh 2026-08-03:** §3 (Location) and most of §4 (Groups) have since **shipped**. This document has been updated in place to mark what landed, record where the implementation deliberately diverged from the spec, and narrow the remaining work. Sections describing shipped work now read as "as built" rather than "to build". Events (§5) is detailed further in [2026-08-03-events-feature-spec.md](./2026-08-03-events-feature-spec.md).

---

## 0. Status — what is already shipped

Verified against source. These are **done**, not backlog:

| Area | State |
|---|---|
| **Auth** | AWS Cognito (backend-proxy). **Email + password sign-in** (PR #8). JWKS RS256 verification on HTTP + WebSocket; `token_use=access` enforced on both. Cognito owns registration, confirmation, forgot/reset, refresh. |
| **File storage** | ImageKit via shared `ImageKitService` (backend-proxied; stores CDN url + fileId; deletes prior file on replace). Avatar, group logo + wallpaper migrated. |
| **Player Profile (§4.2/§4.1)** | Implemented: `biography, country, city, dateOfBirth, sports[], preferredSport, footballPosition, privacy{profileVisibility,showStats,showMatchHistory}, inviteCode, highlightVideos[], gallery[]`, plus `GET /users/:id/profile` (privacy-filtered), `GET /users/me/qr`, extended `PATCH /users/me`. Stats are partial (see §2.3). |
| **Location (§3)** — *shipped 2026-08-03* | `locations` collection with derived GeoJSON + `2dsphere`, CRUD routes, group attach/detach (max 5). **Diverged from spec:** rows may be *group*-owned as well as creator-owned (§3.3). `GET /locations/search` not built (§3.5). |
| **Groups (§4)** — *shipped 2026-08-03* | `logo/logoFileId`, `sportType`, unique `handle`, `teamRules`, `locations[]`; `captain` role + `level` 1–3; search, QR, rules, member-role and location routes (§4.6). |

Design docs exist for **phone-number sign-in** and **verified email change** (separate specs); not covered here.

### Verification method

Every "current state" block below was re-read from `src/` on the branch this doc lives on. Where the previous version's claims were wrong, they are corrected inline.

The 2026-08-03 status refresh re-verified §2–§4 against `main` at `0b429fc`. Blocks marked **AS BUILT** describe code that exists; blocks marked **NOT SHIPPED** are still backlog.

---

## 1. Executive Summary — Coverage Matrix

*Status column refreshed 2026-08-03 against `main` @ `0b429fc`.*

| Spec v2 area | Status today | Action |
|---|---|---|
| §4.1 User Management | **Mostly done** | Remaining: `role`, `favouriteTeam`, username autogeneration (§2.2) — **none shipped** |
| §4.2 Player Profile | **Mostly done** | Remaining: real statistics (needs §5 + §8), gallery/highlight **upload routes** |
| §4.3 Groups | ✅ **Shipped** | Logo, sportType, handle, teamRules, captains + levels, locations all landed (§4.2, §4.3, §4.6). Remaining: Posts feed (§14 #4), group gallery upload |
| §4.4 Group Invitations | Partial | Search + QR **shipped**; §14 #5 approval inconsistency **resolved by design** ([pre-events §6b](./2026-08-03-pre-events-changes.md)) — to build. Still open: invite-link deep-link format |
| §4.5 Events | Partial | **Rework** status → 6-state lifecycle; **add** MVP, multi-team fixtures, photos, cover, templates → [detailed spec](./2026-08-03-events-feature-spec.md) |
| §4.6 Public Events | Partial | **Add** geo discovery (now unblocked — `Location.geo` exists); auto-close-when-full |
| §4.7 Tournament Management | Data-model only | **Build engine** — bracket gen, league fixtures, standings, winner propagation |
| §4.8 Team Challenge | **Missing** | **Build** — new module |
| §4.9 Group Chat | Partial | **Add** attachment upload transport (ImageKit) |
| §4.10 Player Ratings | **Missing** | **Build** — new `ratings` module |
| §4.11 Financial Management | **Missing** | **Build** — new group funds module |
| **Location (cross-cutting)** | ✅ **Shipped** | Collection, CRUD, geo index, group attach/detach all landed (§3). Remaining: `GET /locations/search` |
| Future §7 (AI matching, live tracking, push, dark mode, i18n) | Out of scope | Defer |

**Unimplemented feature areas:** Player Ratings (§4.10), Financial Management (§4.11), Team Challenge (§4.8). **Model-without-engine:** Tournaments (§4.7), chat attachments (§4.9). **Next up:** Events (§5).

---

## 2. Users (§4.1, §4.2)

### 2.1 Current state — VERIFIED

`src/users/schemas/user.schema.ts` has:
`cognitoSub` (unique), `name`, `username` (unique sparse), `displayName`, `email`, `phoneNumber`, `height`, `weight`, `profileImage`, `profileImageFileId`, `emailVerified`, `biography`, `country`, `city`, `dateOfBirth`, `sports[]`, `preferredSport`, `footballPosition`, `privacy{...}`, `inviteCode`, `highlightVideos[]`, `gallery[]`, timestamps.

> Correction to the previous version: `passwordHash`, `emailVerificationToken`, `passwordResetToken`, `passwordResetExpiry`, `refreshTokenVersion` were **removed** in the Cognito migration and no longer exist.

`UpdateProfileDto` accepts: name, username, displayName, phoneNumber, height, weight, biography, country, city, dateOfBirth, sports, preferredSport, footballPosition, privacy. Identity fields (`cognitoSub`, `email`, `emailVerified`, `inviteCode`, `profileImageFileId`) are deliberately **excluded** — the DTO is the write-whitelist.

### 2.2 Remaining additions to `User` — ❌ NOT SHIPPED (re-verified 2026-08-03)

Neither field exists on the schema or in `UpdateProfileDto`; username autogeneration is not implemented either — `auth.service.ts` leaves `username` unset at signup and the user picks one later via `PATCH /users/me`.

```
role: string            // enum: player | owner | admin (spec §3 target users)
favouriteTeam: string   // e.g. 'arsenal', 'manchester-united' — free string or slug enum
```

**Username autogeneration (new requirement).** Username is derived from the display name at signup rather than user-supplied:
- Slugify the name (lowercase, strip non-alphanumeric), truncate to a short prefix, append a numeric suffix. Example: `"Thar Htet"` → `thar0011002`.
- On duplicate key, regenerate the suffix and retry (bounded retries).
- `username` stays unique+sparse; users may still change it later via `PATCH /users/me` (already supported, with a conflict check).

### 2.3 Derived profile data — current reality

`GET /users/:id/profile` assembles:
- **Match history** — real, from `EventPlayer` → `Event`.
- **Statistics** — `matchesPlayed` is real; `wins`, `mvpCount`, `avgRating` currently return **0 with TODOs**, because they need Event after-match results (§5) and Ratings (§8). Wire them when those land.
- **Highlight videos / Gallery** — fields exist (`string[]` of ImageKit URLs); **upload routes are not built yet** (§9.3 covers the video multer option needed).

### 2.4 New/changed routes

| Method | Path | Change |
|---|---|---|
| PATCH | `/users/me` | **CHANGED** — additionally accept `role`, `favouriteTeam` |
| POST | `/users/me/gallery` | **NEW** — upload gallery image (ImageKit) |
| POST | `/users/me/highlights` | **NEW** — upload highlight video (ImageKit, video multer per §9.3) |

> The previous version's §2.5 ("email verification is a dead path") and the `POST /auth/confirm-email` fix are **deleted** — that code no longer exists; Cognito owns verification.

---

## 3. Location — collection (cross-cutting) — ✅ SHIPPED 2026-08-03

> **AS BUILT.** This section shipped, with one deliberate divergence: locations may be **group-owned** in addition to creator-owned. The design rationale below is retained; §3.3 and §3.5 are updated to match the code. Implemented across `src/locations/` (schema, service, controller, DTOs) plus the group attach/detach routes in `src/groups/`.

**Problem being solved.** Location is currently modelled three inconsistent ways: flat `locationName/latitude/longitude` duplicated on `Group` and `Event`; a proposed "multilocation object array" on Group; and a proposed `/groups/:id/maps` sub-resource. A group needs **many** locations, an event needs **one**, and a challenge needs one.

**Decision.** A single `locations` collection, but **not a shared/global venue registry**. Each row is **owned by the user who created it** (`createdBy`) and is reusable **by that creator** across their own groups/events. Two users adding the same real-world pitch produce **two rows** — this duplication is **intentional and accepted** for this phase.

**Why per-user rather than global:** a shared registry raises questions this phase doesn't need to answer — who may rename or correct a venue, and whether one user's edit should change what every other group sees. Per-user ownership keeps edit permissions trivial (the creator owns their row) at the cost of duplicate rows.

**Consequence to be aware of:** geo discovery (§5.7) matches against location rows, so the same physical pitch may appear as several nearby results (one per creator). That is expected behaviour here, not a defect. If a canonical venue registry is wanted later, it is an additive change (introduce a `venueId` that locations point at) rather than a rewrite.

### 3.1 New schema `Location`

```
locations/{id}
{
  name: string              // required, e.g. "Shwe Pitch, Bangkok"
  lat: number               // required
  lng: number               // required
  geo: { type: 'Point', coordinates: [lng, lat] }   // derived from lat/lng; 2dsphere index
  url: string               // optional — Google Maps / venue link
  metadata: Mixed           // free-form, location-intrinsic extras:
                            //   e.g. { surface:'grass', indoor:false, pitches:2, parking:true, notes:'...' }
  createdBy: ObjectId->User // required — creator. Indexed.
  groupId: ObjectId->Group | null   // AS BUILT — owning group, or null for personal.
                                    //   null → creator-only edit/delete
                                    //   set  → group owner/admin/captain may edit;
                                    //          owner/admin may delete
  createdAt / updatedAt
}
```

> **Divergence from the original design.** The spec said "only `createdBy` may edit/delete". As built, a location can be handed to a group via `groupId`, which makes "who may manage this venue" survive the creator leaving or going inactive — a group's home ground shouldn't become uneditable because one member created it. Personal rows (`groupId: null`) behave exactly as originally specified. See §3.3.

**Indexes:** `2dsphere` on `geo` (enables §5.7 "events near me"); `createdBy` (list "my locations"); text or prefix index on `name` for search.

**Why `geo` in addition to `lat`/`lng`:** MongoDB geo queries (`$near`, `$geoWithin`) require GeoJSON with a `2dsphere` index. `lat`/`lng` stay as plain readable numbers; `geo` is derived from them in a pre-save hook so the two can't drift. Callers never set `geo` directly.

**`metadata` holds location-intrinsic extras only** (surface, indoor, pitch count, parking, notes). It should not carry relationship data (`refType`/`refId`) — which thing uses a location is expressed by the referrer holding the ref (§3.2), so one location can serve several of its creator's groups/events without a metadata rewrite.

### 3.2 How other collections reference it

| Collection | Field | Cardinality |
|---|---|---|
| `Group` | `locations: [ObjectId->Location]` | **many** — max 5 (group's home grounds / regular pitches) |
| `Event` | `locationId: ObjectId->Location \| null` | one |
| `Challenge` (§10) | `locationId: ObjectId->Location \| null` | one |

Referrers hold the ref; a location does not point back at its consumers. This is what lets one of the creator's locations be attached to several of their groups/events.

### 3.3 Ownership & reuse (no dedupe) — AS BUILT

**Permission matrix** (`LocationsService.assertCanEdit` / `assertCanDelete`):

| Row type | Edit (name, pin, url, metadata) | Delete |
|---|---|---|
| Personal (`groupId: null`) | creator only | creator only |
| Group-owned (`groupId` set) | creator, **or** group `owner`/`admin`/`captain` | creator, **or** group `owner`/`admin` |

Deleting is held to a stricter role than editing on purpose: removing a venue the group relies on is a structural change, so captains can correct a pin but not remove the ground.

- **No dedupe.** Creating a location always inserts a new row; there is no name/proximity matching. Duplicates across users are expected and accepted.
- **Reuse:** a location may be attached to any number of groups/events its manager controls.
- **Attach permission:** attaching to a group requires group `owner`/`admin`. `EventsService.create` currently requires the stricter `assertOwnedBy` (creator-only) — see the note below.
- **Detach ≠ delete:** removing a location from a group detaches the ref only. `LocationsService.remove` additionally `$pull`s the id from every `Group.locations` array, so a deleted row leaves no stale ref counting toward the 5-location cap.
- **Group adoption:** `adoptPersonalLocations` supports the mobile "create location, then create group" flow — on group creation, still-personal rows created by that user are transferred to the new group. Rows already owned by another group are skipped, never reassigned.

> **Known gap (2026-08-03):** `EventsService.create` calls `assertOwnedBy`, not `assertCanEdit`, so a group admin **cannot attach their own group's home ground to a group event** unless they personally created that location row. Tracked in the [Events spec §4.6](./2026-08-03-events-feature-spec.md).

### 3.4 Migration (replaces the flat fields) — ✅ DONE

> **AS BUILT.** Completed in `13a3948` (schema/DTO swap) and `13b2423` (persist `locationId` with an ownership check). All 12 call sites below were updated; the flat fields no longer exist on either schema. A `groupId` backfill script shipped in `c26c2fb` under `scripts/`.

Remove `locationName`, `latitude`, `longitude` from **both** `Group` and `Event` schemas and their DTOs, replacing with the refs in §3.2.

**Call sites that must be updated** (verified — 12 occurrences):
- `src/groups/schemas/group.schema.ts` (3 fields), `src/groups/dto/create-group.dto.ts` (3)
- `src/events/schemas/event.schema.ts` (3), `src/events/dto/create-event.dto.ts` (3)
- `src/users/users.service.ts:165` — match-history projection selects `locationName`; change to populate `locationId` (or select `locationId` and populate `name`).

**One-off data migration:** for each existing Group/Event with a non-empty `locationName`, insert a `Location` owned by that group's `ownerId` / event's `createdBy`, and set the ref. No dedupe — one row per source record. Rows with no location data get `null`/`[]`.

### 3.5 Routes

| Method | Path | Description | Status |
|---|---|---|---|
| POST | `/locations` | Create (always inserts; `createdBy` = caller; optional `groupId` to make it group-owned, gated to that group's owner/admin) | ✅ shipped |
| GET | `/locations` | List the caller's own locations | ✅ shipped |
| GET | `/locations/search?q=&near=&radius=` | Search by name and/or proximity | ❌ **not built** |
| GET | `/locations/:id` | Detail | ✅ shipped |
| PATCH | `/locations/:id` | Update name/lat/lng/url/metadata — per the §3.3 matrix | ✅ shipped |
| DELETE | `/locations/:id` | Delete — per the §3.3 matrix (also `$pull`s the ref from groups) | ✅ shipped |
| GET | `/groups/:id/locations` | Group's locations | ✅ shipped |
| POST | `/groups/:id/locations` | Attach a location to a group (max 5; accepts an existing `locationId` or a new location payload) | ✅ shipped |
| DELETE | `/groups/:id/locations/:locationId` | Detach (does not delete the Location row) | ✅ shipped |

> **Remaining:** `GET /locations/search`. The `2dsphere` index and a `name` index both exist, so this is a service method plus a route — the data layer is ready. Note it is also the last piece the Events geo-discovery work (§5.7) does *not* depend on: that query goes through `Location.geo` directly.

> Detaching from a group must **not** delete the location row — the owner's other groups/events may reference it.

---

## 4. Groups & Invitations (§4.3, §4.4) — ✅ MOSTLY SHIPPED 2026-08-03

> **AS BUILT.** §4.2 (schema additions), §4.3 (captain role + levels) and all but two rows of §4.6 (routes) shipped. §4.1 below is the *pre-change* state, kept for history. Still outstanding: group Posts (§14 #4), group gallery upload, and the invite-link deep-link format. The §14 #5 approval inconsistency is **resolved by design** and specified in [pre-events changes](./2026-08-03-pre-events-changes.md) §6b (to build).

### 4.1 Current state — VERIFIED (pre-change, 2026-07-28)

`Group`: `name`, `description`, `ownerId`, `wallpaper`, `locationName`, `latitude`, `longitude`, `isPrivate`, `maxPlayers`, `inviteCode`, `inviteCodeExpiry`.
`GroupMember`: `groupId`, `userId`, `role` (enum `owner|admin|member`), `status` (enum **`pending|approved`**), `joinedAt`. No separate Invitation collection — pending members ARE the invitations.

> Corrections to the previous version: Group does **not** have `country`/`city` (it has the flat location trio, being replaced per §3). GroupMember status has **no `rejected` value** — reject deletes the row.

### 4.2 Schema additions to `Group` — ✅ SHIPPED

All landed as specified (`f09dbf4`). As built:

```
logo: string        // team logo/crest — distinct from `wallpaper` (the cover photo)
logoFileId: string  // ImageKit fileId for replace/delete
wallpaperFileId: string            // added alongside, same reason
sportType: string   // enum football | futsal | padel | basketball
handle: string      // unique sparse index, trimmed
teamRules: [string] // max 3 as shipped — CAP BEING REMOVED (see pre-events changes §4.2)
locations: [ObjectId->Location]   // §3.2 — max 5, enforced via GroupsService.MAX_LOCATIONS
```

Indexes as built: `inviteCode` unique sparse, `handle` unique sparse, `name` text.

Notes:
- `wallpaper` (existing) = the cover/banner photo. `logo` (new) = the team crest. The screenshots show both.
- `homeGround` is **not** added — it is subsumed by `locations` (§3). *(The previous version listed it and simultaneously annotated "should remove"; resolved here as: removed.)*
- ~~`country`/`city` are **not** added to Group — derive from the referenced `Location`.~~ **REVERSED 2026-08-03:** `country` and `city` **are** being added to Group as optional free-text fields. A team's country/city is a property of the team, not of any one pitch it plays on, and the new `GET /events?region=` filter needs it on the group directly rather than via a `Group.locations[] → Location` join on every query. See [pre-events changes](./2026-08-03-pre-events-changes.md) §4.1.
- `isPrivate` (existing) means the group is excluded from search results (§4.5 Team Name search).

### 4.3 GroupMember — captains & member levels — ⚠️ PARTIALLY SHIPPED

**Shipped:** `role` enum extended to `owner | admin | captain | member`; `level: number` (enum `1|2|3`, default 1) added; both settable via `PATCH /groups/:id/members/:userId/role`.

```
role: 'owner' | 'admin' | 'captain' | 'member'   // default 'member'
level: 1 | 2 | 3                                  // default 1
```

**NOT shipped — the "plus one" rule.** The `level` field exists and is settable, but **nothing reads it**: no code grants a level-3 member any capability, and there is no plus-one/guest-invite flow anywhere in the codebase. The field is currently inert storage.

> **Open question (§14 #10) — still OPEN, now with a shipped field attached to it.** The data model was built on an assumption that was never confirmed. Before building plus-one, confirm: what distinguishes levels 1/2/3, how is level assigned/promoted, and is "plus one" per-event or per-group? If the answer diverges from `1|2|3`, the enum is cheap to change now and expensive after clients depend on it.

### 4.4 Group sub-content (screenshots: Events / Posts / Members / Gallery tabs)

- **Posts** → new `group_posts` collection (announcements, coaching materials). Overlaps with chat announcements (§9); **Decision needed** (§14 #4).
- **Gallery** → `gallery: [string]` (ImageKit URLs) on Group + upload route.
- **Events tab** → already served by `GET /events?groupId=`.

### 4.5 Invitations / join flow (§4.4)

Current **as shipped today**: request-to-join (pending → owner approves), plus `inviteCode` + `join-by-code` (which **auto-approves**, bypassing owner approval). The auto-approve half is being changed — see the table below and [pre-events changes](./2026-08-03-pre-events-changes.md) §6b.

| Join method | Status | Action |
|---|---|---|
| Team Name search | ✅ **Shipped** | `GET /groups/search?q=` — case-insensitive regex over `name` **and** `handle`, excludes `isPrivate`, limit 20 |
| Invitation Link | ✅ **Shipped** | `GET /groups/:id/qr` returns `{ inviteCode, inviteLink, expiresAt }`; reuses the unexpired code rather than churning a new one (`f0e254b`) |
| QR Code | ✅ **Shipped** | Same endpoint — returns the payload; client renders the QR |
| Owner approval | ✅ **Resolved by design** (to build) | Both paths require approval: `join-by-code` creates a `pending` row instead of auto-approving. Spec'd in [pre-events changes](./2026-08-03-pre-events-changes.md) §6b; §14 #5 closed |
| Challenge from other team | Missing | Covered by Team Challenge (§10) |

### 4.6 New/changed routes

| Method | Path | Change | Status |
|---|---|---|---|
| GET | `/groups/search?q=` | search by name/handle; excludes private groups | ✅ shipped |
| POST | `/groups/:id/logo` | upload team logo (ImageKit) | ✅ shipped |
| POST | `/groups/:id/wallpaper` | upload cover photo (ImageKit) | ✅ shipped |
| PATCH | `/groups/:id` | accept `sportType`, `handle`, `teamRules` — returns **409** on a taken handle (`34fc1a4`) | ✅ shipped |
| GET | `/groups/:id/qr` | QR/invite-link payload | ✅ shipped |
| PATCH | `/groups/:id/members/:userId/role` | promote to captain/admin, set `level` | ✅ shipped |
| GET/POST | `/groups/:id/rules` | team rules — **max 3 as shipped; cap being removed** ([pre-events §4.2](./2026-08-03-pre-events-changes.md)) | ✅ shipped |
| GET/POST/DELETE | `/groups/:id/locations` | see §3.5, **max 5** | ✅ shipped |
| GET | `/groups/:id/members`, `/groups/:id/invite-code` | listing + code retrieval | ✅ shipped |
| DELETE | `/groups/:id/members/:userId` | remove a member | ✅ shipped |
| GET/POST | `/groups/:id/posts` | **NEW** (if Posts is a separate feed — §14 #4) | ❌ not built |
| POST | `/groups/:id/gallery` | **NEW** — upload gallery media (ImageKit) | ❌ not built |
| DELETE | `/groups/:id/rules` | rule removal — POST replaces the whole array as built | ❌ not built |

> **Note on rules:** as built, `POST /groups/:id/rules` **replaces** the entire `teamRules` array (validated at max 3 as shipped; that cap is being removed) rather than appending, so a separate DELETE is unnecessary for the current client. Listed above as not-built for accuracy against the original spec row.

---

## 5. Events & Lifecycle (§4.5, §4.6) — NEXT UP

> **Detailed design:** [2026-08-03-events-feature-spec.md](./2026-08-03-events-feature-spec.md) expands this section into an implementable spec and locks §14 #6 (shuffle strategy → fixed N colour teams) and the fixture format (generic double round-robin). Read that document before implementing; the sections below remain the authoritative statement of *what* is needed.

### 5.1 Current state — VERIFIED (updated 2026-08-03)

`Event`: `title`, `description`, `date`, `groupId`, `isPublic`, `createdBy`, **`locationId`**, `maxPlayers`, `joinedCount`, `sportType`, `skillLevel`, `price`, `status` (**`open|full|done`**), timestamps.

> **Correction (2026-08-03):** the flat `locationName`/`latitude`/`longitude` trio is **gone** — `locationId: ObjectId->Location` replaced it in `13a3948`/`13b2423`. The §5.4 line "REPLACES locationName/latitude/longitude" is therefore already satisfied; only the *other* §5.4 fields remain to build.
`EventPlayer`: `eventId`, `userId`, `joinedAt`, `team`, `position`, `status` (`joined|cancelled`), `checkInTime`.

The current `status` is a **capacity model** (auto open↔full on join/leave; `done` never set) — NOT the spec lifecycle.

### 5.2 Status rework — lifecycle (§4.5 table)

Replace the capacity-based enum. Capacity becomes derived (`joinedCount >= maxPlayers`), not a status.

```
status enum: join | before_match | preparation | playing | after_match | done
```

| Status | Meaning | Allowed actions |
|---|---|---|
| `join` | Registration open | join / **unjoin** |
| `before_match` | Registration closed, awaiting match time | organizer finalizes; no new joins |
| `preparation` | Teams generated, lineups finalized, **team chats open**, **fixtures generated** | shuffle runs here |
| `playing` | Match in progress | per-fixture scores entered |
| `after_match` | Match ended | results, **MVP**, **ratings**, photos |
| `done` | Archived | team chats archived; history/stats retained |

Transitions are **manual and organizer-gated** (`PATCH /events/:id/status`) with a legal-transition table; no scheduler. "Unjoin" is an action valid only in `join`, not a state.

> A full task-by-task plan for this rework already exists: `docs/superpowers/plans/2026-07-23-event-lifecycle-rework.md`.

### 5.3 Multi-team fixtures & results

**Gap.** A single `scoreA`/`scoreB` can't represent the event-results screen, which shows a **4-team double round-robin**: four colour-named teams (Red, Yellow, Blue, Black), each playing 6 matches, **12 fixtures total within one event**, each with an independent result.

**Format clarification:** this is a **double round-robin** — with 4 teams there are 6 unique pairings, and each pairing is played **twice** (matches 1–6, then repeated as 7–12). Each team therefore plays 6 matches. The repeated pairings in the fixture list are intentional, not a transcription error.

| Match | Team A | Team B | | Match | Team A | Team B |
|---|---|---|---|---|---|---|
| 1 | Red | Yellow | | 7 | Yellow | Red |
| 2 | Blue | Black | | 8 | Blue | Black |
| 3 | Black | Red | | 9 | Black | Red |
| 4 | Blue | Yellow | | 10 | Blue | Yellow |
| 5 | Yellow | Black | | 11 | Yellow | Black |
| 6 | Blue | Red | | 12 | Blue | Red |

**Schema — `EventMatch`, embedded as `Event.matches[]`:**

```
matches: [{
  matchNumber: number       // 1..N, fixed order
  teamA: string             // team id assigned during shuffle, e.g. colour
  teamB: string
  scoreA: number | null     // null until played (UI renders a dash)
  scoreB: number | null
  playedAt: Date | null
}]
```

**Scoring:** win = 3, draw = 1, loss = 0 — same scheme as league standings (§6.2). Standings are **derived on read** from `matches[]`, never stored.

**Rules:**
1. Fixtures are generated **once**, on entry to `preparation`, alongside team shuffle (§5.6) — immutable afterward except score entry.
2. Generation must give every team an equal number of matches (4 teams → 6 each, 12 total).
3. Scores stay `null` until played, then set via `PATCH /events/:id/matches/:matchNumber`.

**Relationship to `Event.result` (resolved):** for multi-team events, `matches[]` is the **sole source of truth for scores**. `Event.result` retains only `mvpUserId` (plus an optional overall summary for simple 2-team events). The two must not both carry authoritative scores.

### 5.4 Schema additions to `Event`

```
locationId: ObjectId->Location | null   // ✅ ALREADY SHIPPED (§5.1) — listed for completeness
startTime: Date                          // spec separates Match date + Time
endTime: Date
coverImage: string                       // event_detail cover
coverImageFileId: string                 // ImageKit fileId
result: {
  mvpUserId: ObjectId->User              // §4.5 MVP selection
  scoreA: number | null                  // optional, simple 2-team events only
  scoreB: number | null
}
matches: EventMatch[]                    // §5.3 — authoritative scores for multi-team
photos: [string]                         // after-match photos (ImageKit)
templateId: ObjectId | null              // §5.5
```

### 5.5 Event templates

New `event_templates` collection: saved defaults (title, locationId, maxPlayers, price, sportType, recurrence hint) owned by a user/group. `POST /events` accepts optional `templateId` to prefill; `POST /event-templates` to save.

### 5.6 Shuffle integration (preparation)

Current `shuffle.service.ts` chunks joined players into random groups of 6, notifies them, and is **not** tied to the lifecycle.

- **Gate to `preparation`** — reject otherwise.
- **Team balancing** — currently pure-random buckets of 6. **Decision needed** (§14 #6): keep random, balance by `skillLevel`/`footballPosition`, or fixed N colour teams.
- **Fixture generation** — when the event has >2 teams, generate `matches[]` (§5.3) in the same transition.
- **Team chats** — create per-team rooms (`eventId`+`team`); archive on `done`.

### 5.7 Public events / discovery (§4.6)

- **Geo query** — `GET /events?near=<lat>,<lng>&radius=` via the `2dsphere` index on `Location.geo` (§3.1), joining through `locationId`. This is why Location carries GeoJSON.
- **Auto-close when full** — block joins at capacity, tied to the `join` state (not a `full` status).

### 5.8 New/changed routes

| Method | Path | Change |
|---|---|---|
| PATCH | `/events/:id` | **NEW** — edit event (organizer) |
| DELETE | `/events/:id` | **NEW** — cancel/delete (organizer) |
| PATCH | `/events/:id/status` | **NEW** — advance lifecycle |
| POST | `/events/:id/result` | **NEW** — submit MVP (+ optional overall score) |
| PATCH | `/events/:id/matches/:matchNumber` | **NEW** — submit a fixture's score (§5.3) |
| POST | `/events/:id/photos` | **NEW** — after-match photos (ImageKit) |
| POST | `/events/:id/cover` | **NEW** — cover image (ImageKit) |
| GET | `/events?near=&radius=` | **CHANGED** — geo discovery via Location |
| POST | `/events/:id/like` | **NEW** — event_detail "Like" |
| POST/GET | `/event-templates` | **NEW** |
| POST | `/events/:id/shuffle` | **CHANGED** — gated to `preparation`; creates team chats; generates fixtures |

---

## 6. Tournaments (§4.7) — build the engine

### 6.1 Current state — VERIFIED

`Tournament`, `TournamentTeam`, `TournamentMatch` exist (with `nextMatchId`, `type: knockout|league`), but `tournaments.service.ts` has **no bracket generation, no league fixtures, no standings, no winner propagation**. `winnerId` is client-supplied; `nextMatchId` never advances; `status` never leaves `registering`. Match status enum: `scheduled | in_progress | completed | walkover`.

### 6.2 Changes

**Knockout:** `generateKnockoutBracket()` — seed, build rounds, create matches, wire `nextMatchId`, handle byes. On completion, compute `winnerId` from scores and **propagate** to the next match; mark `finished` when the final completes.

**League:** `generateLeagueSchedule()` — round-robin fixtures. **Standings** as a points table (played/W/D/L/GF/GA/GD/points) using **win 3 / draw 1 / loss 0** (same as §5.3). Winner = top of standings when all matches complete. Storage: recomputed collection vs computed-on-read — **Decision needed** (§14 #7).

**Status lifecycle:** `registering → ongoing` on generate; `ongoing → finished` on completion.

### 6.3 New/changed routes

| Method | Path | Change |
|---|---|---|
| GET | `/tournaments` | **NEW** — list (filter by group/status) |
| POST | `/tournaments/:id/generate` | **NEW** — bracket or fixtures |
| GET | `/tournaments/:id/standings` | **NEW** |
| PATCH | `/tournaments/:id/matches/:matchId` | **CHANGED** — propagate winner, advance status |
| GET | `/tournaments/:id` | keep |

---

## 7. Public Events / Discovery (§4.6)

Covered by §5.7 (geo query via `Location.geo`) and §5.2 (capacity tied to `join` state).

---

## 8. Player Ratings (§4.10) — NEW module

### 8.1 Schema `Rating`

```
ratings/{id}
{
  eventId: ObjectId->Event
  raterId: ObjectId->User
  rateeId: ObjectId->User
  stars: number        // 1..5
  comment: string
  createdAt: Date
}
```

**Constraint:** unique compound index `{ eventId, raterId, rateeId }` — one rating per rater→ratee per event. (Cardinality interpretation: **Decision needed**, §14 #8.)

**Gating:** only accepted while event `status == after_match`.

### 8.2 Routes

| Method | Path | Description |
|---|---|---|
| POST | `/events/:id/ratings` | Submit (after_match; rater & ratee both joined) |
| GET | `/users/:id/ratings` | Aggregate (avg stars, count) for profile |
| GET | `/events/:id/ratings` | Ratings for a match (MVP/summary) |

Feeds the `avgRating` stat currently stubbed at 0 (§2.3).

---

## 9. Chat (§4.9) — attachment transport

### 9.1 Current state — VERIFIED

`Message` is **only** `{ groupId, senderId, text }`. Real-time works via `chat.gateway.ts` (Socket.io, **Cognito JWKS** handshake, room-per-group, membership-checked, `cognitoSub`→Mongo `_id` translation). History via `GET /groups/:id/messages`.

### 9.2 Changes

```
type: enum text | image | video | file    // default text
attachmentUrl: string                      // ImageKit CDN url
attachmentFileId: string                   // ImageKit fileId
attachmentMeta: { name, size, mimeType }
```

- **Upload transport:** `POST /groups/:id/messages/attachment` (member-only) → `ImageKitService` → returns url + fileId → client sends `sendMessage` with `type` + `attachmentUrl`. Extend the gateway payload accordingly.
- **Announcements:** add `isAnnouncement` / pinned flag (owner/admin). Overlaps with Posts (§4.4) — §14 #4.
- **Team chats:** scope rooms to `eventId`+`team` during `preparation`; archive on `done`.

### 9.3 Video uploads

Video goes to **ImageKit** (handles video natively). The existing `multerMemoryImageOptions` is image-MIME-only — add a sibling **`multerMemoryVideoOptions`** (video MIME allowlist, larger size cap) reusing `ImageKitService.upload`. Needed by chat video, highlight videos (§2.4), and coaching materials.

---

## 10. Team Challenge (§4.8) — NEW module

```
challenges/{id}
{
  fromGroupId: ObjectId->Group
  toGroupId: ObjectId->Group
  proposedDate: Date
  locationId: ObjectId->Location | null   // §3
  numberOfPlayers: number
  status: enum pending | accepted | rejected | cancelled
  createdBy: ObjectId->User
  respondedBy: ObjectId->User | null
  resultingEventId: ObjectId->Event | null
}
```

| Method | Path | Description |
|---|---|---|
| POST | `/challenges` | Create (challenger owner/admin) |
| GET | `/challenges?groupId=` | Incoming/outgoing for a group |
| PATCH | `/challenges/:id` | Accept / reject (challenged owner/admin) — notifies challenger |

On accept: notify, optionally spawn the match event.

---

## 11. Financial Management (§4.11) — NEW module

```
group_funds/{groupId}                fund_transactions/{id}
{                                    {
  groupId (unique)                     groupId, type: contribution|expense
  balance: number                      amount: number
  currency: string                     category: football|jersey|training_bib|
}                                                equipment|ground_rental|fee|other
                                       eventId | null, userId | null
                                       note, createdBy, createdAt
                                     }
```

Balance = Σ contributions − Σ expenses. Event `price` can auto-create a contribution on join.

**Scope: bookkeeping ledger only.** The module records money that changes hands offline (cash/bank transfer); it does **not** integrate a payment gateway. Collecting real payments (gateway, webhooks, refunds, payouts) is out of scope for this change set.

| Method | Path | Description |
|---|---|---|
| GET | `/groups/:id/fund` | Balance + summary (members) |
| GET | `/groups/:id/fund/transactions` | Ledger (members) |
| POST | `/groups/:id/fund/transactions` | Record entry (owner/admin) |

---

## 12. Notifications — broaden triggers

Current: `{ userId, title, body, type, refId, isRead }`; the **only** trigger is the shuffle service.

Add: invitation requested/approved/rejected; challenge received/accepted/rejected; event lifecycle transitions (incl. after_match "rate your teammates"); tournament match scheduled / result posted. Extend `type` enum with `challenge`, `rating`, `tournament`.

---

## 13. Workflows & Scenarios

End-to-end flows for the main journeys. These encode the gating rules stated elsewhere in this doc — where a diagram and prose disagree, the prose section is authoritative.

### 13.1 User signup & first login (Cognito)

Email + password sign-in. A PreSignUp Lambda auto-confirms users (bypassing email-code delivery); Cognito remains the identity source of truth, Mongo holds the profile.

📊 **Diagram:** [`spec-v2-13-1-user-signup-login.mmd`](../diagrams/spec-v2-13-1-user-signup-login.mmd) — mermaid source (GitHub renders it on open).

### 13.2 Group creation → member invitation → approval

Covers all three join paths (§4.5).

> **Updated 2026-08-03:** §14 #5 is resolved — invite-link/QR joins now require approval too, so both paths converge on `status: pending`. The diagram below reflects the target behaviour; the auto-approve branch it previously showed is being removed ([pre-events changes](./2026-08-03-pre-events-changes.md) §6b).

📊 **Diagram:** [`spec-v2-13-2-group-join-approval.mmd`](../diagrams/spec-v2-13-2-group-join-approval.mmd) — mermaid source (GitHub renders it on open).

### 13.3 Event lifecycle (creation → done)

The 6-state machine from §5.2. Transitions are manual and organizer-gated; capacity is derived, not a state.

📊 **Diagram:** [`spec-v2-13-3-event-lifecycle.mmd`](../diagrams/spec-v2-13-3-event-lifecycle.mmd) — mermaid source (GitHub renders it on open).

### 13.4 Team shuffle & fixture generation (preparation)

📊 **Diagram:** [`spec-v2-13-4-team-shuffle-fixtures.mmd`](../diagrams/spec-v2-13-4-team-shuffle-fixtures.mmd) — mermaid source (GitHub renders it on open).

### 13.5 Match results, MVP & ratings (playing → after_match)

📊 **Diagram:** [`spec-v2-13-5-match-results-mvp-ratings.mmd`](../diagrams/spec-v2-13-5-match-results-mvp-ratings.mmd) — mermaid source (GitHub renders it on open).

### 13.6 Team challenge (group vs group)

📊 **Diagram:** [`spec-v2-13-6-team-challenge.mmd`](../diagrams/spec-v2-13-6-team-challenge.mmd) — mermaid source (GitHub renders it on open).

### 13.7 Location attach (creator- or group-owned)

How any collection attaches a location (§3.3). No dedupe — creating always inserts.

> **Updated 2026-08-03:** as built, a location may be group-owned, so the ownership check is the §3.3 permission matrix, not a bare `createdBy` comparison. One exception: `EventsService` still uses the strict creator-only check — the known gap noted in §3.3.

📊 **Diagram:** [`spec-v2-13-7-location-attach.mmd`](../diagrams/spec-v2-13-7-location-attach.mmd) — mermaid source (GitHub renders it on open).

### 13.8 File upload (ImageKit, backend-proxied)

Applies to avatar, group logo/wallpaper/gallery, event cover/photos, chat attachments, highlight videos.

📊 **Diagram:** [`spec-v2-13-8-file-upload-imagekit.mmd`](../diagrams/spec-v2-13-8-file-upload-imagekit.mmd) — mermaid source (GitHub renders it on open).

---

## 14. Open Decisions

*Refreshed 2026-08-03.*

| # | Decision | Status |
|---|---|---|
| 1 | Email verification | ✅ RESOLVED — Cognito |
| 2 | OAuth (Google/Facebook) | ✅ RESOLVED — stubs removed; can add via Cognito IdPs later |
| 3 | Highlight/gallery storage | ✅ RESOLVED — ImageKit. Sub-question: arrays vs a `media` collection if per-item metadata is needed |
| 4 | **Group Posts vs chat announcements** — separate feed, or pinned messages? | OPEN — nothing built either way |
| 5 | **Invite-link approval** — should join-by-link/QR still require owner approval? | ✅ RESOLVED 2026-08-03 — **yes, approval required**. Join-by-code now creates a `pending` row like request-to-join. See [pre-events changes](./2026-08-03-pre-events-changes.md) §6b |
| 6 | **Shuffle strategy** — random buckets of 6, skill/position-balanced, or fixed N colour teams? | ✅ RESOLVED 2026-08-03 — **fixed N colour teams** (`teamCount`, default 4). See the [Events spec](./2026-08-03-events-feature-spec.md) §3 |
| 7 | **League standings storage** — recomputed collection vs computed-on-read | ✅ RESOLVED for *events* — computed-on-read (Events spec §4.3). Still OPEN for **tournaments** (§6.2) |
| 8 | **Ratings cardinality** — one per match total, or one per teammate per match? | OPEN |
| 9 | Chat/video upload limits & storage | ✅ RESOLVED — ImageKit |
| 10 | **Member levels & "plus one"** — what do levels 1/2/3 mean, how are they assigned, is plus-one per-event or per-group? (§4.3) | OPEN — **and now urgent**: the `level` enum shipped on an unconfirmed assumption and is inert. Cheaper to change before clients depend on it |
| 11 | **Location ownership model** (new) — group-owned locations were added beyond the original creator-only design (§3.3) | ✅ RESOLVED by implementation — documented in §3.3; flagged here because it changed a stated design decision |

---

## 15. Suggested Build Order

*Progress marked 2026-08-03.*

1. ~~**Location collection (§3)**~~ — ✅ **DONE**. Foundational; unblocked group multi-location and event geo discovery. *(Remaining scrap: `GET /locations/search`.)*
2. ~~**Group field extensions (§4)**~~ — ✅ **DONE**. Logo, sportType, handle, rules, captains/levels, locations. *(Remaining scrap: Posts, gallery upload.)*
3. **Event lifecycle rework (§5)** — ⬅️ **NEXT**. Biggest behavioural change; unblocks ratings, stats, team chats. *(Spec: [2026-08-03-events-feature-spec.md](./2026-08-03-events-feature-spec.md). The older `2026-07-23-event-lifecycle-rework.md` plan is superseded by it.)*
4. **Multi-team fixtures (§5.3)** — extends the lifecycle work; do in the same pass as shuffle. Folded into the Events spec above.
5. **Player Ratings (§8)** — depends on `after_match`; then wire the stubbed profile stats.
6. **Tournament engine (§6)** — self-contained.
7. **Team Challenge (§10)** + **Financial (§11)** — independent modules.
8. **Chat attachments (§9)** + **Notification triggers (§12)** + gallery/highlight upload routes (§2.4).

**Small leftovers worth batching** (each is hours, not days, and none blocks the critical path): `GET /locations/search`; `role` + `favouriteTeam` on User; username autogeneration (§2.2); the `EventsService` location-permission fix (§3.3); group gallery upload.

Future §7 items (AI matching, live tracking, GPS check-in, push, dark mode, i18n, referee management, badges) remain **out of scope**.

---

## 16. Collections — target vs current

*"Current" column re-verified 2026-08-03 against `main` @ `0b429fc`.*

| Collection | Current | After changes |
|---|---|---|
| users | ✅ — `role`/`favouriteTeam` **still missing** | ✅ |
| notifications | ✅ — shuffle is still the only trigger | ✅ (more triggers) |
| groups | ✅ — **extended**: logo, sportType, handle, teamRules, locations[] | ✅ |
| group_members | ✅ — **extended**: captain role + level 1–3 | ✅ |
| messages | ✅ — still `{groupId, senderId, text}` only | ✅ (+attachments) |
| events | ✅ — `locationId` landed; status rework + `matches[]` outstanding | ✅ |
| tournaments / teams / matches | ✅ (add engine) | ✅ |
| **locations** | ✅ **shipped** (§3) — incl. `groupId` ownership | ✅ |
| ratings | ❌ | ✅ **new** (§8) |
| challenges | ❌ | ✅ **new** (§10) |
| group_funds / fund_transactions | ❌ | ✅ **new** (§11) |
| event_templates | ❌ | ✅ **new** (§5.5) |
| event_likes / event_team_chats | ❌ | ✅ **new** — added by the [Events spec](./2026-08-03-events-feature-spec.md) §4.4 |
| group_posts | ❌ | maybe (§14 #4) |
| tournament_standings | ❌ | maybe (§14 #7) |
