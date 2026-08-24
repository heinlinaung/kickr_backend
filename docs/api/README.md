# KickR API docs (for the Flutter app)

Integration guides written against the **live** API — every request/response shown was captured from a real call, not from source reading.

| Doc | Covers |
|---|---|
| [auth-api.md](./auth-api.md) | Signup (incl. the optional `name`), login, **refresh**, forgot/reset password, **change password** (authenticated). Token storage and the 401→refresh→retry loop. |
| [groups-and-locations-api.md](./groups-and-locations-api.md) | Locations (venues) and Groups (fields, `country`/`city`, images, rules, members/roles, search, QR invites, joining). |
| [events-api.md](./events-api.md) | Events — the 6-state lifecycle (incl. **`ready_to_play`**), derived `isFull`, listing a group's events, **free-text search**, create/edit/delete, join/leave. ⚠️ **breaking status change**. |
| [users-api.md](./users-api.md) | Users — **people search** (name/username, exact-email only), and the profile routes. ⚠️ written from source, not captured live. |
| [admin-api.md](./admin-api.md) | **Back-office only**, behind the `x-admin-key` shared secret — force-add users to a group or event, and seed a throwaway test fixture (§9). Not for the mobile app. |

**Live reference while the server is running:** Swagger UI at `/api-docs`, OpenAPI JSON at `/api-docs-json`.

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
