# KickR API docs (for the Flutter app)

Integration guides written against the **live** API — every request/response shown was captured from a real call, not from source reading.

| Doc | Covers |
|---|---|
| [auth-api.md](./auth-api.md) | Signup (incl. the optional `name`), login, **refresh**, forgot/reset password. Token storage and the 401→refresh→retry loop. |
| [groups-and-locations-api.md](./groups-and-locations-api.md) | Locations (venues) and Groups (fields, `country`/`city`, images, rules, members/roles, search, QR invites, joining). |
| [events-api.md](./events-api.md) | Events — the 5-state lifecycle, derived `isFull`, listing a group's events, create/edit/delete, join/leave. ⚠️ **breaking status change**. |
| [admin-api.md](./admin-api.md) | **Back-office only**, behind the `x-admin-key` shared secret — force-add users to a group or event, and seed a throwaway test fixture (§9). Not for the mobile app. |

**Live reference while the server is running:** Swagger UI at `/api-docs`, OpenAPI JSON at `/api-docs-json`.

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
