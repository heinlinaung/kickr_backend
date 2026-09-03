# KickR API docs (for the Flutter app)

Integration guides written against the **live** API — every request/response shown was captured from a real call, not from source reading.

| Doc | Covers |
|---|---|
| [auth-api.md](./auth-api.md) | Signup (incl. the optional `name`), login, **refresh**, forgot/reset password, **change password** (authenticated). Token storage and the 401→refresh→retry loop. |
| [groups-and-locations-api.md](./groups-and-locations-api.md) | Locations (venues) and Groups (fields, `country`/`city`, images, rules, members/roles, search, QR invites, joining). |
| [events-api.md](./events-api.md) | Events — the 6-state lifecycle (incl. **`ready_to_play`**), derived `isFull`, listing a group's events, **free-text search**, create/edit/delete, join/leave. ⚠️ **breaking status change**. |
| [users-api.md](./users-api.md) | Users — **people search** (name/username, exact-email only), and the profile routes. ⚠️ written from source, not captured live. |
| [notifications-api.md](./notifications-api.md) | Notifications — the in-app list, the socket.io `/notifications` namespace, and **FCM device registration**. Two triggers today: event created, and event → `ready_to_play`. ⚠️ written from source, not captured live. |
| [admin-api.md](./admin-api.md) | **Back-office only**, behind the `x-admin-key` shared secret — force-add users to a group or event, and seed a throwaway test fixture (§9). Not for the mobile app. |

**Live reference while the server is running:** Swagger UI at `/api-docs`, OpenAPI JSON at `/api-docs-json`.

## ⚠️ Changed — 2026-09-03 · `GET /events` hides finished events

`after_match` and `done` are now excluded by **default** from the discovery
list. An explicit `?status=after_match` or `?status=done` still returns them, so
history screens keep working — only the default changed.

The other event lists (`/events/joined`, `/events/group/:id`, `/events/search`)
still hide `done` alone and continue to show `after_match`. That difference is
deliberate; see [events §5.1](./events-api.md).

## New — 2026-09-02 · Push notifications

**Two triggers only:** an event is created (→ the group's approved members,
minus the creator), and an event moves to `ready_to_play` (→ the users joined
to it). Everything else in the app still has no notification.

Delivered three ways — the persisted list, a socket.io banner, and FCM push.
**The list is the source of truth**; both deliveries are best-effort and a
notification can never fail the action that triggered it, so a missing banner
does not mean a missing action.

Push requires **`POST /notifications/devices`** with the FCM token after login
and on every token refresh, and **`DELETE /notifications/devices/:fcmToken`**
on logout. Device tokens are push credentials and are **never readable** — they
are excluded from `GET /users/me` and every other user response.

See [notifications-api.md](./notifications-api.md).

## New — 2026-09-02 · `DELETE /groups/:id`

**Owner only** (an admin gets `403`), **irreversible**, and a cascade over eleven collections: the group, its members, its events — with every event's players, guests, fixtures, teams, chats, likes and payments — plus its templates, messages and locations.

**Tournaments are deliberately NOT cascaded** while that module is still being designed, so they survive pointing at a deleted group. The response reports how many as `orphanedTournaments` — treat a non-zero value as manual work.

The response carries per-collection counts so you can confirm the blast radius. There is no archive or undo anywhere in this API, so a confirmation step naming those counts is strongly advised.

One dangling reference is accepted by design: locations are deleted rather than orphaned, so an event outside the group that adopted one of its venues keeps a `locationId` that no longer resolves. Detail in [groups §3.11](./groups-and-locations-api.md).

## ⚠️ Changed — 2026-09-02

**`duration` moved from the team to the fixture.** `team.duration` is **gone** — read it from `GET /events/:id/matches`, where each fixture now carries its own. It describes a match, not a squad.

**`POST /events/:id/shuffle` no longer overwrites it.** It used to derive `floor((event.duration - 10) / 3)` and write that over the organizer's choice, silently turning a deliberate `15` into `26`. It now reuses the scheduled duration.

The match count is unchanged — still `max(roundRobin, slots)`, so a short event can still overrun. Detail in [events-api §11.1](./events-api.md).

## New — 2026-08-31

**Guest players (`+1` / `+2`)** — a member brings a friend with no account; an organizer approves or rejects them. Four routes under `/events/:id/guests`. Detail in [events-api §13](./events-api.md).

Seven things to build against:

1. **Guests are opt-in per event.** Set `isAllowExtraPlayer: true` at create (or via `PATCH`) or `POST /guests` returns `400`. Defaults to false, and events created earlier read as false.
2. **Only members of THAT event may invite.** A `status: joined` roster row on the specific event — group membership is not enough.
3. **A guest row has no `userId`.** Branch on `type: "guest"` and read `guestName`. No placeholder account is ever created.
4. **`guestName` is optional** — omit it and the server names them `"<sponsor> guest <n>"`, so a bare "+ Add Guest" button needs no input.
5. **`joinedCount` can exceed `maxPlayers`.** Capacity is a soft limit for guests by decision, so `isFull` flips true and joining closes for everyone else — but going over is allowed, not an error.
6. **Leaving takes your guests with you.** The leave and remove responses carry `guestsRemoved`.
7. **Guests never hold a payment row** — the sponsor covers them.

**Guests in teams shipped 2026-09-01.** A squad is now the union of `team.players` (user ids) and `team.guests` (roster-row ids) — render both, or you drop guests. `PATCH /teams/:teamId` takes `guestIds`, the shuffle deals guests, `numberOfPlayers` counts them, and `EventPlayer.team` is stamped for guests so a guest's own row says which team they are in. Standings need no change — they carry no player names.

## New — 2026-08-29

- **`GET` / `PATCH /events/:id/payments`** — record whether each member has paid. Role-aware: organizers see everyone, a member sees only their own row. No amount is stored per member; compute it from the event.
- **`PATCH /events/:id/teams/:teamId/members/:userId/role`** — name a team captain. Owner/admin **or group captain**.
- **`additionalPrice` / `takeAdditionalPrice` on the event** — a surcharge and its on/off switch, kept separate so the amount survives being switched off.

- **`GET /events` now returns the caller's joined events too**, private ones included — being on the roster is the permission. Every row carries **`joinedByMe`**, so don't assume a row from this route is public. Note this route still applies no default date/status filter.

**Fixed:** `GET /events/:id/matches` now fills the booked slot. A 2-hour event of 10-minute matches gives **11** fixtures for 3 teams, not 6 — extra slots repeat the round-robin, which stays the floor. Detail in [events-api §11.1 and §12](./events-api.md).

## ⚠️ Breaking changes — 2026-08-27

Three fixes to the events API:

1. **`GET /events/joined` no longer shows finished events.** A `done` event is excluded even with `includeExpired=true` — that flag is about dates, not completion. Use `?status=done` for a history view.
2. **`POST /events/:id/teams/generate` returns only `{ message }`.** The `teams`, `matches`, `matchCount` and `schedule` fields are **gone** — read them back from `GET /events/:id/teams` and `GET /events/:id/matches`. It also accepts a new optional **`colors`** array to name the teams (count must equal `teamsCount`, names must be distinct; spelling is not validated).
3. **The fixture list is no longer truncated to the booked slot.** The full double round-robin is generated, so 3 teams give 6 matches, not the 2–3 that `GET /events/:id/matches` used to show. **Plan for the schedule exceeding the event duration** — the server no longer prevents it.

Detail in [events-api §5.1b and §11.1](./events-api.md).

## ⚠️ Breaking changes — 2026-08-26

**Group privacy is now enforced on contents instead of on discovery.** `isPrivate` previously did exactly one thing — hide a group from search. That is inverted:

- **`GET /groups/search` now returns private groups.** Read `isPrivate` per result and show a lock + "Request to join"; navigating in will `403`.
- **Search returns a reduced card, and `inviteCode` is no longer in it.** It used to be returned for every hit.
- **`GET /groups/:id/members` and `GET /events/group/:groupId` now `403`** for a private group unless the caller is an **approved** member (pending is not enough). Neither ever `403`'d before.
- **`GET /groups/search` with an empty `q` returns `[]`** instead of an arbitrary 20 groups.

Also: **`GET /groups/:id/members` no longer returns member email addresses.** It was ungated, so anyone could harvest the email of every member of every group. `username`/`displayName`/`profileImage` are returned instead; a build reading `userId.email` gets `undefined` by design.

Detail in [groups §3.4b](./groups-and-locations-api.md).

## ⚠️ Breaking change — 2026-08-20

**New `ready_to_play` lifecycle stage**, between `preparation` and `playing`:
`join → preparation → ready_to_play → playing → after_match → done`.

**`PATCH /events/:id/status` from `preparation` straight to `playing` now returns `409`.** Any client with a "start match" button on the team-assignment screen breaks until it routes through `ready_to_play`.

The new state is where teams are **final and reviewable but the match has not kicked off** — the roster is frozen, so shuffling and team writes are refused there (`400`), unlike in `preparation`. A reverse edge `ready_to_play → preparation` exists for fixing a wrong team set; nothing is lost, since no score can exist yet.

**No data migration** — no existing event can hold the new value and nothing stored becomes invalid. Handle the sixth value in any `switch` on `status`. Detail in [events-api §3](./events-api.md).

## New — `POST /auth/change-password`

Lets a **logged-in** user change their own password: `{ currentPassword, newPassword }` with a bearer token, no email involved. It is the first authenticated route on the auth controller — the others all serve users who cannot log in.

Two things to get right in the client:

1. **A `401` from this route means "wrong current password", not "expired session".** Exempt it from the refresh-and-retry interceptor, or a typo logs the user out.
2. **Send no `email` field.** The account comes from the token; an unknown body field is a `400`.

Other devices are **not** signed out — see [auth-api §6.2](./auth-api.md).

## New — search endpoints

Two new routes. Both are additive — nothing existing changed — but they are
**cursor-paginated from the start**, so their `data` is a page object rather than
the plain array the older listing routes return:

- **`GET /events/search?q=`** — free text over event `title`/`description`, public events only, soonest first. See [events-api §5.3](./events-api.md).
- **`GET /users/search?q=`** — people by name/username/displayName, or by an **exact** email. See [users-api §3](./users-api.md).

Both share the same three rules, and all three surprise people:

1. **An empty `q` returns an empty page**, not every row — neither route is a listing call.
2. **Both return a page object, not an array**: `data` is `{ items, nextCursor, hasMore }`. Pagination is **cursor-based** — send `nextCursor` back verbatim, and stop when `hasMore` is `false`. `limit` (max 50) is a page size, not a result cap.
3. **Neither ranks by relevance.** Events come back soonest-first; users in `_id` order.

The user route additionally matches an email **only in full** (`?q=@gmail.com` finds nobody) and **never returns the `email` field**, so results cannot be mined for addresses.

## ⚠️ Breaking changes — 2026-08-18

**`before_match` removed from the event lifecycle.** `join` now advances straight to `preparation`, and `preparation → join` reopens registration. `PATCH /events/:id/status` with `"before_match"` returns `400`. Run `scripts/migrate-remove-before-match.ts` before deploying, or events sitting in that state are stranded — the new enum refuses every move out of it.

**`numberOfPlayers` is now enforced.** `PATCH /events/:id/teams/:teamId` rejects a roster larger than the team's `numberOfPlayers`. Under-filling is still fine.

Full detail in [the changelog](../change-logs/2026-08-18.md).

## ⚠️ Breaking changes — 2026-08-13

**`group.rules` is a string, not an array.** It was `string[]`; it is now one block of free-form text with newlines preserved. A build doing `List<String>.from(j['rules'])` crashes. Existing groups were migrated by joining entries with `\n` — run `scripts/migrate-group-rules-to-text.ts` before deploying.

**`PUT /events/:id/teams` is removed.** Teams are created empty by `POST /events/:id/teams/generate` (which also derives the fixture list from `event.duration`), then populated by `PATCH /events/:id/teams/:teamId`.

**`GET /events/group/:groupId` hides expired and `done` events** unless `?includeExpired=true`.

Full detail in [the changelog](../change-logs/2026-08-13.md).

## ⚠️ Breaking change — 2026-08-09

**Event `status` values changed.** The `open | full | done` enum is replaced by the match lifecycle `join → preparation → playing → after_match → done`. (That release also had a `before_match` state between `join` and `preparation`; it was removed on 2026-08-18 — see below.)

`open` becomes `join`; **`full` is removed entirely** — a full event stays in `join` and capacity is exposed as the derived boolean `isFull`. Any build matching `"open"` or `"full"` breaks. See [events-api §2.2 and §3](./events-api.md).

Same release: new `GET /events/group/:groupId` (a group's events, private ones visible to approved members), plus `PATCH /events/:id`, `DELETE /events/:id` and `PATCH /events/:id/status`.

## ⚠️ Breaking change — 2026-08-03

**Joining by invite code / QR now requires owner approval.** It used to add the user immediately.

`POST /groups/join-by-code` returns `status: "pending"`; the user is **not** a member until an owner/admin approves. A build that navigates into the group on success will drop the user into a group they haven't joined, and every member-only call will `403`. See [groups-and-locations-api §3.6](./groups-and-locations-api.md).

Same release: `GET /groups/:id/qr` is now open to any authenticated user, `GET /groups/:id` returns the caller's `userRole`/`memberStatus`, team rules lost their max-3 cap (and preserve newlines), and groups gained optional `country`/`city`.

## Read this first

Two conventions apply to every endpoint in the auth and groups docs:

1. **Success responses are wrapped in `data`**; error responses are **flat**, and `message` may be a **string or a list of strings**.
2. **Send the Cognito `accessToken`** as `Authorization: Bearer …` — the `idToken` is rejected with `401`.

The admin doc shares convention 1 but **not** 2 — it authenticates with the `x-admin-key` header instead of a user token.

Each doc ends with a **gotchas checklist** and a **"not built yet"** section, so the app isn't designed against unimplemented features.
