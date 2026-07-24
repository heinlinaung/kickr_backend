
# KickR Backend — Spec v2 Changes (Gap Analysis & Change Spec)

**Date:** 2026-07-26
**Author:** Backend team
**Baseline:** [2026-06-20 KickR Backend Phase 1 Design Spec](./2026-06-20-kickr-backend-design.md)
**Drivers:** `kickr-spec-v2.pdf` (Football Event & Tournament Management Platform) + Flutter reference screenshots (`screenshots/*.png`)
**Stack:** NestJS · MongoDB (Mongoose) · Socket.io · **AWS Cognito** (auth) · **ImageKit** (file storage/CDN)

> **Stack note:** JWT/Nodemailer auth and local-disk multer uploads (as this doc originally assumed) have since been **replaced**: auth is now AWS Cognito (RS256/JWKS), and file uploads go to **ImageKit** (backend-proxied, storing url + fileId). See the Update Log below — references to "local disk / multer / S3" in the storage sections are superseded by ImageKit.

---

## 0.1 Update Log (post-authoring)

Work shipped since this gap analysis was written (all on branch `worktree-kickr-spec-v2-changes`):

- **Auth → AWS Cognito** — custom bcrypt/JWT/nodemailer replaced with Cognito (backend-proxy, username sign-in, JWKS verification on HTTP + WebSocket). This resolves §11 decision #1 (email verification is now Cognito's) and #2 (OAuth stubs removed).
- **File storage → ImageKit** — local-disk multer replaced by a shared `ImageKitService` (backend-proxied upload via SDK; stores full CDN url + fileId; deletes prior file on replace). Avatar upload migrated; group logo/wallpaper, gallery, event photos, and chat/highlight **video** all use this path going forward. This resolves §11 decisions #3 and #10 and the §9.3 video-size note. ImageKit handles video, so the old 5MB image-only / S3 concerns no longer apply.
- **Player Profile (§4.2/§4.1)** — profile fields, privacy, QR/invite link, public profile, partial stats: implemented.

---

## 0. Purpose

This document is a **change spec**, not a from-scratch design. It reverifies the current `kickr-backend` implementation against **spec v2** and the Flutter screenshots, then defines exactly what must be **added**, **changed**, or **fixed** to reach v2 parity.

Every item below was confirmed by reading the actual source in `src/` (schemas, services, controllers), not assumed from the Phase 1 spec.

### Verification method

Each domain (users/auth, groups/invitations, events/shuffle, tournaments/chat/notifications, ratings/finance/challenge) was audited field-by-field against spec §4. Two contested findings were re-verified directly against source:
- `src/chat/schemas/message.schema.ts` → confirmed only `{ groupId, senderId, text }`; **no** attachment/media fields.
- `src/tournaments/tournaments.service.ts` → confirmed **no** bracket/fixture/standings generation exists.

---

## 1. Executive Summary — Coverage Matrix

| Spec v2 area | Status today | Action |
|---|---|---|
| §4.1 User Management | Partial | **Extend** — add country/city, sports, position, privacy, DOB, role; **fix** email verification |
| §4.2 Player Profile | Partial | **Extend** — biography, statistics, match history, ratings, highlight videos, gallery, QR/invite link |
| §4.3 Groups | Partial | **Extend** — logo, country, city, home ground, team rules, sport type, captains |
| §4.4 Group Invitations | Partial | **Add** join-by-team-name & QR; **fix** invite link vs approval |
| §4.5 Events | Partial | **Rework** status → 7-state lifecycle; **add** MVP, scores, photos, cover, templates |
| §4.6 Public Events | Partial | **Add** nearby/geo discovery; auto-close-when-full |
| §4.7 Tournament Management | Data-model only | **Build engine** — bracket gen, league fixtures, standings, winner propagation, status lifecycle |
| §4.8 Team Challenge | **Missing** | **Build** — new module |
| §4.9 Group Chat | Partial | **Add** attachment upload transport (video/file/materials) |
| §4.10 Player Ratings | **Missing** | **Build** — new `ratings` module |
| §4.11 Financial Management | **Missing** | **Build** — new group funds module |
| §6 `ratings` collection | **Missing** | Covered by §4.10 build |
| Future §7 (AI matching, live tracking, push, dark mode, i18n) | Out of scope | Defer |

**Three entire feature areas are unimplemented: Player Ratings (§4.10), Financial Management (§4.11), Team Challenge (§4.8).** Two areas have data models but no engine: Tournaments (§4.7) and chat attachments (§4.9). Everything else is field-level extension plus one correctness fix (email verification).

---

## 2. Users & Auth (§4.1, §4.2)

### 2.1 Current state (`src/users/schemas/user.schema.ts`)

Present: `name`, `username`, `displayName`, `email`, `passwordHash`, `phoneNumber`, `height`, `weight`, `profileImage`, `emailVerified`, `emailVerificationToken`, `passwordResetToken`, `passwordResetExpiry`, `refreshTokenVersion`, timestamps.

`UpdateProfileDto` allows editing only: `name`, `username`, `displayName`, `phoneNumber`, `height`, `weight`.

### 2.2 Schema additions to `User`

```
// Profile / location
country: string                       // ISO code or name (spec §4.1, edit-profile screen)
city: string
biography: string                     // "Description" field in edit-profile screen
dateOfBirth: Date                     // profile shows age; store DOB, derive age
role: string                          // enum: player | owner | admin (spec §3 target users)

// Sport preferences (§4.1 "Sport preferences", "Football position selection")
sports: string[]                      // e.g. ['football','padel','go-kart'] — screenshots show multi-sport
preferredSport: string                // "Sport Type" single-select on edit-profile
footballPosition: string              // enum: goalkeeper | defender | midfielder | forward | playmaker
                                      // only meaningful when 'football' in sports

// Privacy (§4.1 "Privacy settings")
privacy: {
  profileVisibility: string           // enum: public | members | private (default public)
  showStats: boolean                  // default true
  showMatchHistory: boolean           // default true
}

// Profile identity (§4.2 "QR Code or Invitation Link")
inviteCode: string                    // unique sparse — encodes profile share link / QR payload
favouriteTeam: string                 // eg. arsenal, manchester-united, manchester-city, 
```

### 2.3 Derived / referenced profile data (§4.2)

These are **not** stored on `User` but assembled from other collections when `GET /users/:id/profile` is called:

- **Match history** → derived from `EventPlayer` + `Event` (events the user joined, past `date`).
- **Statistics** → aggregated from match results (matches played, wins, MVP count, avg rating). Requires the Events lifecycle rework (§4) to have result data.
- **Player ratings** → aggregated from the new `ratings` collection (§7).
- **Highlight videos** → `highlightVideos: string[]` (ImageKit CDN URLs). Field implemented; the upload route uploads video via `ImageKitService` (see §0.1). A dedicated `media` collection remains optional if per-item metadata is later needed.
- **Achievements (Gallery)** → `gallery: string[]` (ImageKit CDN URLs) on `User`. Field implemented; upload route uploads via `ImageKitService`.

### 2.4 DTO changes

Extend `UpdateProfileDto` to accept: `country`, `city`, `biography`, `dateOfBirth`, `role`, `sports`, `preferredSport`, `footballPosition`, `privacy`. Add validation (enum guards for `role`, `footballPosition`, `privacy.profileVisibility`).

### 2.5 Correctness FIX — email verification is a dead path

**Bug:** `auth.service.ts` `signup()` hardcodes `emailVerified: true` and never sets `emailVerificationToken` nor sends a verification email. `confirmEmail()` can therefore never match a user, and `login()` never checks `emailVerified`. The `POST /auth/confirm-email` endpoint is unreachable in practice.

**Change:**
1. On signup: set `emailVerified: false`, generate `emailVerificationToken` (UUID), send verification email via existing nodemailer setup.
2. `confirmEmail()`: match token, set `emailVerified: true`, clear token.
3. `login()`: reject (403) if `!emailVerified`, with a clear message.
4. Add `POST /auth/resend-verification`.
5. `username` should be autogenerated value from display name, eg. thar0011002 from Thar Htet

> Note: if the product wants frictionless onboarding, keep `emailVerified: true` default but make it an explicit documented decision rather than a silent no-op. See §11.

### 2.6 New/changed routes

| Method | Path | Change |
|---|---|---|
| GET | `/users/:id/profile` | **NEW** — public profile (respects `privacy`); assembles match history, stats, ratings, gallery |
| GET | `/users/me/qr` | **NEW** — returns invite code / QR payload for profile sharing |
| PATCH | `/users/me` | **CHANGED** — accept new profile fields |
| POST | `/auth/resend-verification` | **NEW** |
| POST | `/auth/confirm-email` | **FIX** — make functional |

Google/Facebook OAuth remain **stubs** (501) — keep deferred unless product requires; note in §11.

---

## 3. Groups & Invitations (§4.3, §4.4)

### 3.1 Current state

`Group`: `name`, `description`, `ownerId`, `wallpaper`, `country`, `city`, `isPrivate`, `maxPlayers`, `inviteCode`, `inviteCodeExpiry`.
`GroupMember`: `groupId`, `userId`, `role` (owner|admin|member), `status` (pending|approved|rejected), `joinedAt`. No separate Invitation collection — pending members ARE the invitations.
Multilocation need to provide for `locationName`, `latitude`, `longitude` as object array.

### 3.2 Schema additions to `Group`

```
logo: string                 // team logo (§4.3) — distinct from wallpaper; screenshots show both
country: string              // create-group form has Country select
city: string                 // create-group form has City select
homeGround: string           // §4.3 "Home ground" — dedicated field (keep lat/lng for map)
teamRules: string            // §4.3 "Team rules" — "Add Rules and Map Location" in group screen
sportType: string            // §4.3 + create-group "Sport Type" select (enum football|futsal|padel|...)
handle: string               // unique — the "@Bangkok FC" handle shown in group_detail screenshot
```

### 3.3 GroupMember change — captains (§4.3)

Spec lists **Captains** as a distinct group role. Extend `role` enum to `owner | admin | captain | member`. Captains are member-promoted; used later for tournament team seeding and event lineup.

### 3.4 Group sub-content (screenshots: Events / Posts / Members / Gallery tabs)

- **Posts** → new `group_posts` collection (announcements, coaching materials). Overlaps with chat announcements (§4.9); **Decision needed** whether Posts == pinned chat messages or a separate feed. See §11.
- **Gallery** → `gallery: string[]` on Group or a shared `media` collection (see §11).
- **Events tab** → already served by `GET /events?groupId=`.

### 3.5 Invitations / join flow (§4.4)

Current: request-to-join (pending → owner approves), plus `inviteCode` + `join-by-code` (which **auto-approves**, bypassing owner approval).

Spec §4.4 join methods: **QR Code**, **Team Name**, **Invitation Link**, **Approve/Reject Challenge from other team**. "Group owners approve new members before joining."

| Join method | Status | Action |
|---|---|---|
| Team Name search | **Missing** | **Add** `GET /groups/search?q=` + request-to-join |
| Invitation Link | Partial (raw code) | **Change** to a formatted deep link / URL wrapping `inviteCode` |
| QR Code | Partial | **Add** QR payload endpoint (encodes the invite link); client renders QR |
| Owner approval | Present | **Fix inconsistency**: `join-by-code` currently auto-approves. Reconcile with "owners approve before joining" — decide whether invite-link joins skip approval or still require it. See §11. |
| Challenge from other team | Missing | Covered by Team Challenge module (§6) |

### 3.6 New/changed routes

| Method | Path | Change |
|---|---|---|
| GET | `/groups/search?q=` | **NEW** — search by team name/handle |
| POST | `/groups/:id/logo` | **NEW** — upload team logo (multipart) |
| PATCH | `/groups/:id` | **CHANGED** — accept country, city, homeGround, teamRules, sportType, handle |
| GET | `/groups/:id/qr` | **NEW** — QR/invite-link payload |
| PATCH | `/groups/:id/members/:userId/role` | **NEW** — promote to captain/admin |
| GET | `/groups/:id/posts`, POST `/groups/:id/posts` | **NEW** (if Posts is a separate feed — see §11) |
| POST | `/groups/:id/gallery` | **NEW** — upload gallery media |

---

## 4. Events & Lifecycle (§4.5, §4.6)

### 4.1 Current state

`Event`: `title`, `description`, `date`, `groupId`, `isPublic`, `createdBy`, `maxPlayers`, `joinedCount`, `sportType`, `skillLevel`, `price`, `status` (**open|full|done**), timestamps.
`EventPlayer`: `eventId`, `userId`, `joinedAt`, `team`, `position`, `status` (joined|cancelled), `checkInTime` `{location ref}` (locationName, latitude, longitude).

The current `status` is a **capacity model** (auto open↔full on join/leave; `done` never set). It is NOT the spec lifecycle.

### 4.2 Status rework — 7-state lifecycle (§4.5 table)

Replace the capacity-based `status` enum with the spec lifecycle. Capacity (full vs not) becomes a derived boolean (`joinedCount >= maxPlayers`), not a status.

### 4.3 Match Fixtures & Results

**Overview**

Introduce a Match Fixtures & Results screen that displays the full round-robin schedule for a 4-team tournament. Each of the four teams — Red, Yellow, Blue, and Black — plays 6 matches, for a total of 12 matches across the competition.

**Teams**

| Team   | Color indicator |
|--------|------------------|
| Red    | Red jersey icon    |
| Yellow | Yellow jersey icon |
| Blue   | Blue jersey icon   |
| Black  | Black jersey icon  |

**Fixture list**

| Match | Team A | Team B | Result |
|-------|--------|--------|--------|
| 1     | Red    | Yellow | —      |
| 2     | Blue   | Black  | —      |
| 3     | Black  | Red    | —      |
| 4     | Blue   | Yellow | —      |
| 5     | Yellow | Black  | —      |
| 6     | Blue   | Red    | —      |
| 7     | Yellow | Red    | —      |
| 8     | Blue   | Black  | —      |
| 9     | Black  | Red    | —      |
| 10    | Blue   | Yellow | —      |
| 11    | Yellow | Black  | —      |
| 12    | Blue   | Red    | —      |

**Functional requirements**

1. The screen must present a table with three columns: **Match** (sequence number 1–12), **Fixture** (Team A vs. Team B, each shown with its color-coded jersey icon), and **Result**.
2. Each team must appear in exactly 6 fixtures, for a total of 12 matches across the tournament.
3. The **Result** field is empty (rendered as a placeholder dash `—`) until the corresponding match has been played, at which point it is populated with the outcome.
4. Match order and pairings must follow the fixture list above and must not be user-editable.
5. The header must clearly state that all teams play 6 matches, so participants understand the format at a glance.
6. winner: 3, draw: 1, lose: 0


```
status enum: join | before_match | preparation | playing | after_match | done
```

Lifecycle semantics (from spec table):

| Status | Meaning | Allowed actions |
|---|---|---|
| `join` | Registration open | join / **unjoin** (unjoin = leave before `preparation`) |
| `before_match` | Registration closed, awaiting match time | organizer reviews/finalizes; no new joins |
| `preparation` | Teams generated/assigned, lineups finalized, **team chats open** | shuffle runs here; team chat rooms created |
| `playing` | Match in progress | scores/stats/events updated real-time |
| `after_match` | Match ended | submit results, **MVP selection**, **player ratings**, photos, comments |
| `done` | Archived | temp team chats archived; history/stats retained |

- "Unjoin" is an **action** valid only while `status == join`, not a stored status (matches the DELETE-join endpoint that already exists — just gate it on lifecycle).
- Add explicit transition endpoints (organizer-gated); do not rely on capacity auto-toggle.

### 4.4 Schema additions to `Event`

```
startTime: string | Date       // spec separates Match date + Time; currently folded into `date`
endTime: Date                   // event_detail screenshot shows "date - null" range → add end
coverImage: string              // event_detail has a cover image; no field today
result: {                       // set in after_match
  scoreA: number
  scoreB: number
  mvpUserId: ObjectId->User      // §4.5 MVP selection
}
photos: string[]                // §4.5 after-match photos
templateId: ObjectId | null     // §4.5 "templates when user creates events"
skillLevel                      // present (keep)
```

### 4.5 Event templates (§4.5 "schedule events / templates")

New `event_templates` collection: a saved set of event defaults (title, venue, maxPlayers, price, sportType, recurrence hint) owned by a user/group. `POST /events` accepts optional `templateId` to prefill; `POST /event-templates` to save one.

### 4.6 Public events / discovery (§4.6)

Spec: organizer enables public event → **nearby** players can join → event closes when full.

- `GET /events` currently returns all `isPublic` events. **Add geo query**: `GET /events?near=<lat>,<lng>&radius=` using a `2dsphere` index on a new `location: { type:'Point', coordinates:[lng,lat] }` field (migrate from flat lat/lng).
- **Auto-close when full**: when `joinedCount >= maxPlayers`, block further joins (already effectively done via capacity) — but tie it to lifecycle `join` state, not the old `full` status.
- The Home "Discover sports events" screen implies a public discovery feed grouped by sport/date.

### 4.7 Shuffle integration (§4.5 preparation)

Current `shuffle.service.ts` chunks joined players into random groups of 6 and notifies them. It is NOT tied to lifecycle and does not create team chats.

- **Gate shuffle to `preparation`**: shuffle should only run (and transition/confirm) when `status == preparation`.
- **Team balancing**: current shuffle is pure-random buckets of 6. Spec preparation says "teams generated or assigned, lineups finalized." **Decision needed**: keep random, or balance by `skillLevel`/`footballPosition`, or split into 2 teams (A/B) vs N groups. See §11.
- **Team chats**: on entering `preparation`, create per-team chat rooms (reuse chat module scoped to `eventId`+`team`). Archive on `done`.

### 4.8 New/changed routes

| Method | Path | Change |
|---|---|---|
| PATCH | `/events/:id` | **NEW** — edit event (organizer) |
| DELETE | `/events/:id` | **NEW** — cancel/delete event (organizer) |
| PATCH | `/events/:id/status` | **NEW** — advance lifecycle (organizer-gated transitions) |
| POST | `/events/:id/result` | **NEW** — submit scores + MVP (in `after_match`) |
| POST | `/events/:id/photos` | **NEW** — upload after-match photos |
| GET | `/events?near=&radius=` | **CHANGED** — geo discovery |
| POST | `/events/:id/like` | **NEW** — event_detail "Like" button |
| POST | `/event-templates`, GET `/event-templates` | **NEW** |
| POST | `/events/:id/shuffle` | **CHANGED** — gated to `preparation`, creates team chats |
| POST | `/events/:id/matches` | **NEW** to check the score and result|

---

## 5. Tournaments (§4.7) — build the engine

### 5.1 Current state

Three schemas exist (`Tournament`, `TournamentTeam`, `TournamentMatch`) with `nextMatchId` for knockout progression and a `type` enum (`knockout|league`). But `tournaments.service.ts` has **no bracket generation, no league fixtures, no standings, and no winner propagation**. Matches can only be read and score-updated; `winnerId` is client-supplied, `nextMatchId` is never advanced, and `status` never leaves `registering`. Match status enum is `scheduled | in_progress | completed | walkover`.

### 5.2 Changes

**Knockout (§4.7 Round 1 → Winner → Semi Final → Final):**
- Add `generateKnockoutBracket(tournamentId)`: seed teams (by `seed`/registration order), build rounds, create `TournamentMatch` docs, wire `nextMatchId`, handle byes.
- On `updateMatch` completion: compute/validate `winnerId` from scores, **propagate** winner into the linked `nextMatchId` slot. Mark tournament `finished` when the final completes.

**League (§4.7 "every team plays every other"; Teams, Matches, Brackets, Scores, Winners, Standings):**
- Add `generateLeagueSchedule(tournamentId)`: round-robin fixture generation.
- **Add Standings**: points table (played/W/D/L/GF/GA/GD/points). Either a `tournament_standings` collection recomputed on match completion, or computed on read. **Decision needed** (see §11).
- League winner = top of standings when all matches `completed`.

**Status lifecycle:**
- `registering → ongoing` on generate; `ongoing → finished` on final/all-matches complete.

### 5.3 New/changed routes

| Method | Path | Change |
|---|---|---|
| GET | `/tournaments` | **NEW** — list (filter by group/status) |
| POST | `/tournaments/:id/generate` | **NEW** — generate bracket (knockout) or fixtures (league) |
| GET | `/tournaments/:id/standings` | **NEW** — league standings |
| PATCH | `/tournaments/:id/matches/:matchId` | **CHANGED** — propagate winner along `nextMatchId`, advance status |
| GET | `/tournaments/:id` | keep (returns tournament + teams + matches/bracket) |

---

## 6. Team Challenge (§4.8) — NEW module

Not implemented at all. Build a `challenges` module.

### 6.1 New schema `Challenge`

```
challenges/{id}
{
  fromGroupId: ObjectId->Group     // challenger
  toGroupId: ObjectId->Group       // challenged
  proposedDate: Date               // §4.8
  location: string                 // §4.8 (+ optional lat/lng)
  numberOfPlayers: number          // §4.8
  status: enum pending | accepted | rejected | cancelled   // §4.8 acceptance status
  createdBy: ObjectId->User
  respondedBy: ObjectId->User | null
  resultingEventId: ObjectId->Event | null   // on accept, optionally spawn an event
}
```

### 6.2 Routes

| Method | Path | Description |
|---|---|---|
| POST | `/challenges` | Create challenge (challenger group owner/admin) |
| GET | `/challenges?groupId=` | List incoming/outgoing challenges for a group |
| PATCH | `/challenges/:id` | Accept / reject (challenged group owner/admin) — notifies challenger |

On accept: notify challenger; optionally create the match event. Ties into §3.5 "Approve or Reject Challenge from other team."

---

## 7. Player Ratings (§4.10) — NEW module

Not implemented at all. Spec §6 also lists a `ratings` collection.

### 7.1 New schema `Rating`

```
ratings/{id}
{
  eventId: ObjectId->Event         // rating is per-match
  raterId: ObjectId->User          // who rated
  rateeId: ObjectId->User          // teammate being rated
  stars: number                    // 1..5 (§4.10)
  comment: string                  // §4.10
  createdAt: Date
}
```

**Constraint (§4.10 "one rating per match"):** unique compound index `{ eventId, raterId, rateeId }` — one rating per rater→ratee per event. (Interpretation: one rating per teammate per match; confirm whether it's one-total-per-match or one-per-teammate. See §11.)

**Gating:** ratings only accepted while event `status == after_match` (see §4.2).

### 7.2 Routes

| Method | Path | Description |
|---|---|---|
| POST | `/events/:id/ratings` | Submit rating (after_match only; rater & ratee both joined) |
| GET | `/users/:id/ratings` | Aggregate rating (avg stars, count) for profile |
| GET | `/events/:id/ratings` | Ratings for a match (for MVP/summary) |

Feeds Player Profile stats (§2.3) and MVP selection (§4.5).

---

## 8. Financial Management (§4.11) — NEW module

Not implemented at all.

### 8.1 New schemas

```
group_funds/{groupId}            // one per group (or embed on Group)
{
  groupId: ObjectId->Group (unique)
  balance: number                // remaining balance stays in fund (§4.11)
  currency: string
}

fund_transactions/{id}
{
  groupId: ObjectId->Group
  type: enum contribution | expense
  amount: number
  category: enum football | jersey | training_bib | equipment | ground_rental | fee | other   // §4.11
  eventId: ObjectId->Event | null   // participation fee linked to an event
  userId: ObjectId->User | null     // who contributed
  note: string
  createdBy: ObjectId->User
  createdAt: Date
}
```

Balance = sum(contributions) − sum(expenses). Participation fees (§4.5 event `price`) can auto-create a `contribution` transaction on join. **Decision needed**: is fee collection actual payment (Stripe/etc.) or just bookkeeping? Assume **bookkeeping only** for this phase. See §11.

### 8.2 Routes

| Method | Path | Description |
|---|---|---|
| GET | `/groups/:id/fund` | Balance + summary (members) |
| GET | `/groups/:id/fund/transactions` | Ledger (members) |
| POST | `/groups/:id/fund/transactions` | Record contribution/expense (owner/admin) |

---

## 9. Chat (§4.9) — attachment transport

### 9.1 Current state

`Message` schema is **only** `{ groupId, senderId, text }` — no attachment fields (verified against source). Real-time text works via `chat.gateway.ts` (Socket.io, JWT handshake, room-per-group, membership-checked). History via `GET /groups/:id/messages`.

Spec §4.9 members can: discuss matches, share announcements, **upload training videos**, **share coaching materials**, discuss strategies. Only plain text is supported.

### 9.2 Changes

Extend `Message`:
```
type: enum text | image | video | file   // default text
attachmentUrl: string                     // uploaded media path
attachmentMeta: { name, size, mimeType }  // optional
```

- **Add upload transport**: `POST /groups/:id/messages/attachment` (multipart, member-only) → uploads via the shared `ImageKitService` (memory-buffer multer → ImageKit) → returns the CDN url + fileId → client sends a `sendMessage` with `type` + `attachmentUrl`. Extend gateway `sendMessage` payload to accept `type`/`attachmentUrl`.
- **Announcements** (§4.9): add `isAnnouncement: boolean` or a pinned flag (owner/admin only). Overlaps with group Posts (§3.4) — reconcile in §11.
- **Team chats** for events (§4.6): scope chat rooms to `eventId`+`team` during `preparation`; archive on `done`.

### 9.3 Video storage — RESOLVED (ImageKit)

Training/highlight video uploads go to **ImageKit** via the shared `ImageKitService` (see Update Log §0.1), which handles video natively — no local-disk size limit and no S3 to set up. The existing image-upload multer (`multerMemoryImageOptions`) is image-MIME-only; add a sibling `multerMemoryVideoOptions` (video MIME allowlist + larger size cap) for video routes, reusing the same `ImageKitService.upload`. The earlier "raise multer limits vs move to S3" question is moot.

---

## 10. Notifications — broaden triggers

Current `Notification`: `{ userId, title, body, type, refId, isRead }`. The **only** trigger in the codebase is the shuffle service; the `group` type is declared but never emitted.

Add triggers (in-app store only; push/FCM stays future per §7):
- Invitation requested / approved / rejected (groups).
- Challenge received / accepted / rejected (§6).
- Event lifecycle transitions (before_match, preparation-with-team-assignment, after_match "rate your teammates").
- Tournament match scheduled / result posted.

Extend `type` enum to include `challenge`, `rating`, `tournament` as needed.

---

## 11. Open Decisions (need product input)

These materially affect implementation and should be resolved before build:

1. ~~**Email verification**~~ — RESOLVED: handled by AWS Cognito (see §0.1).
2. ~~**OAuth**~~ — RESOLVED: Google/Facebook 501 stubs removed; deferred (can be added via Cognito identity providers later).
3. **Highlight videos & Gallery storage** — storage location RESOLVED: **ImageKit** (see §0.1). Remaining sub-question (optional): keep URLs as arrays on the entity (current: `highlightVideos: string[]`, `gallery: string[]`) or move to a dedicated `media` collection if per-item metadata/deletion is needed.
4. **Group Posts vs Chat announcements** — is the "Posts" tab a separate feed, or pinned/announcement chat messages?
5. **Invite-link approval** — should join-by-link/QR still require owner approval (current code auto-approves), matching "owners approve new members before joining"?
6. **Shuffle strategy** — random buckets of 6 (current), skill/position-balanced, or 2-team A/B split? What does "lineups finalized" mean concretely?
7. **League standings storage** — recomputed collection vs computed-on-read.
8. **Ratings cardinality** — one rating per match total, or one per teammate per match?
9. **Financial management** — real payments (Stripe) or bookkeeping ledger only?
10. ~~**Chat/video upload limits & storage**~~ — RESOLVED: all uploads go to **ImageKit** (see §0.1 and §9.3); no local multer size limit / S3 decision remains.

---

## 12. Suggested Build Order (phased)

1. **Correctness first**: fix email verification (§2.5). Low risk, high correctness value.
2. **Profile & Group field extensions** (§2, §3) — schema + DTO additions; unblocks profile/group screens.
3. **Event lifecycle rework** (§4) — the biggest behavioral change; unblocks preparation/team-chat/after-match, which ratings & stats depend on.
4. **Player Ratings** (§7) — depends on after_match lifecycle.
5. **Tournament engine** (§5) — self-contained; bracket + league + standings.
6. **Team Challenge** (§6) and **Financial Management** (§8) — new independent modules.
7. **Chat attachments** (§9) and **Notification triggers** (§10) — cross-cutting polish.

Future §7 items (AI matching, live tracking, GPS check-in, push notifications, dark mode, multi-language, referee management, badges) remain **out of scope** for this change set.

---

## 13. Collections — target vs current

| Collection (spec §6) | Current | After changes |
|---|---|---|
| users | ✅ (extend fields) | ✅ |
| notifications | ✅ | ✅ (more triggers) |
| ratings | ❌ | ✅ **new** (§7) |
| groups | ✅ (extend fields) | ✅ |
| members | ✅ (group_members) | ✅ (+captain role) |
| messages | ✅ (extend: attachments) | ✅ |
| events | ✅ (rework status; add fields) | ✅ |
| tournaments | ✅ (add engine) | ✅ |
| teams | ✅ (tournament_teams) | ✅ |
| matches | ✅ (tournament_matches) | ✅ |
| *(new)* challenges | ❌ | ✅ **new** (§6) |
| *(new)* group_funds / fund_transactions | ❌ | ✅ **new** (§8) |
| *(new)* event_templates | ❌ | ✅ **new** (§4.4) |
| *(new)* tournament_standings *(if collection route chosen)* | ❌ | maybe (§5.2) |
