# 2026-09-17 — sportType collection, group→event inheritance

## What changed

### 1. `sporttypes` collection (new)

Allowed `sportType` values used to live in three hardcoded enums that had
already drifted apart — and one pair was mutually broken:

| Place | Old list |
| --- | --- |
| `group.schema.ts` | football, futsal, padel, basketball |
| `event.schema.ts` | football, futsal |
| event create/update DTOs | football, futsal |
| `create-group`/`update-group` DTOs | football, futsal, padel, basketball |

They are replaced by one reference collection, `sporttypes`
(`src/sport-types/`), seeded by `scripts/seed-sport-types.ts` with the UNION
of the old lists plus badminton:

```
football   (subTypes: futsal, stadium)
futsal
badminton
padel
basketball
```

- `GET /sport-types` (superadmin) returns the list in display order. The apps
  read the same list from public `GET /configuration`.
- Each row's `subTypes` are the formats an EVENT of that sport may set as its
  `subType`. Only football has any.
- Each row's `matchProvided` (boolean, default `true`) says whether events of
  that sport are played as a match. Clients use it to show or hide the match
  timeline on the event detail screen. Every seeded sport is `true`. The seeder
  only backfills rows that have no value yet, so it never overwrites a value a
  superadmin has set. Rows still missing the field read as `true`.
- Groups and events store the plain `value` string, **not** an ObjectId ref.
  `value` is the sport's ID: unique and never changes.
- Each row's `name` is its display label (e.g. `Football`), unique
  case-insensitively. Renaming a sport changes `name` only, so nothing that
  stores the `value` moves. Rows without a name read as their `value`; the
  seeder backfills names but never overwrites one a superadmin has set.
- Adding a sport is now a seed-list edit + `npx ts-node
  scripts/seed-sport-types.ts --apply`, or a call to the superadmin write
  endpoints (§5) — not a deploy.

**Deploy step: run the seeder (`--apply`) before or with this release** — an
unseeded database rejects every sportType write.

### 2. A grouped event's sportType is always its group's

`group.sportType` is the source of truth for every event under the group:

- **Event create** with a `groupId` (sent or template-supplied): the event
  copies the group's sportType. A conflicting value in the payload is a 400;
  omitting it or echoing the group's value is fine. Groups with no sportType
  set don't impose one.
- **Event update**: changing `sportType` on a grouped event to anything other
  than the group's value is a 400 — change the group instead.
- **Group update**: writing `sportType` propagates to every event under the
  group (`EventsService.applyGroupSportType`), clearing any event `subType`
  the new sport does not list. Re-sending the same value doubles as a repair
  pass.
- Standalone events (`groupId: null`) still choose their own sportType.

A football group's events keep `sportType: 'football'` and may pick their
format via `subType` (`futsal` | `stadium`) at create/update.

### 3. Validation moved from DTOs to services

DTOs now check only that `sportType`/`subType` are strings; the value check
happens in `GroupsService`/`EventsService` via
`SportTypesService.assertValid`, which names the valid values in the 400
message. (Service-level because class-validator has no DI container access in
this app — `useContainer` is never called.)

Event **templates** validate `sportType` on save too, so a bad value fails
when the template is created rather than months later on first use.

### 4. Fixed along the way

- `UpdateEventDto.subType` was validated but missing from `update()`'s
  `EDITABLE` allowlist, so a PATCH with `subType` silently no-opped. It now
  applies, and `subType: null` clears the field — which is also how a
  standalone event switches sport without stranding a stale format.
- The event schema's Mongoose-level `enum` on `sportType`/`subType` is gone
  (it would fight the collection); the schema keeps `default: 'football'` and
  `subType: null`.

### 5. Superadmin write endpoints

The list can also be maintained over the API. Every route, reads included, needs a bearer token **and** `role: 'superadmin'` on the caller's user
document (`SuperadminGuard`, run after `JwtAuthGuard`). They do **not** use
the `x-admin-key` shared secret.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/sport-types` | All sports, in display order |
| `GET` | `/sport-types/:value` | One sport |
| `POST` | `/sport-types` | Create; 409 if `value` or `name` exists. `name` defaults to `value`. Omit `sortOrder` to append; `matchProvided` defaults to `true` |
| `PATCH` | `/sport-types/:value` | `name`, `sortOrder` and/or `matchProvided`. `name` renames the display label only — `value` (the ID) is unchanged; 409 if another sport has that name. `value`/`subTypes` are rejected (400) — use the `/sub-types` endpoints for subTypes |
| `DELETE` | `/sport-types/:value` | 409 while any group, event, template or user profile stores it. `?replaceWith=football` moves them all to football first; moved events/templates take the deleted value as `subType` when football lists it (futsal → football + `futsal`), else an unlisted `subType` is cleared |
| `POST` | `/sport-types/:value/sub-types` | Add one subType; 409 if already listed |
| `PUT` | `/sport-types/:value/sub-types/order` | Reorder (`{ subTypes }`): every current subType exactly once, in the new order; 400 otherwise |
| `PATCH` | `/sport-types/:value/sub-types/:subType` | Rename in place (`{ subType }`); events/templates of that sport move to the new name; 409 if already listed |
| `DELETE` | `/sport-types/:value/sub-types/:subType` | 409 while an event or template of that sport uses it |

Auth failures: `401` missing/invalid token, `403` `Superadmin only`.

`User` gains `role: 'user' | 'superadmin'` (default `'user'`). No API writes
it — the profile DTO whitelist rejects it — so promote an account by hand:

```js
db.users.updateOne({ email: "<email>" }, { $set: { role: "superadmin" } })
```

**Deploy step:** existing users have no `role` and count as `'user'`, so
nobody can write sport types until at least one account is promoted.

## Client impact

- `GET /configuration` (`sportTypes`) is the source for sport pickers, including
  per-sport `subTypes` for the event-format picker, and `matchProvided` to
  decide whether the event detail screen shows the match timeline.
- Sending a sportType on a group event that differs from the group's is now a
  400 on both create and update.
- Unknown sports/formats still 400, but the message now lists valid values.
- Sport-type writes (§5) are back-office only: superadmin bearer token, not
  `x-admin-key`.

## Files

- `src/sport-types/` — schema, service, controller, module, write DTOs
  (pattern: `global-football-teams`).
- `src/common/guards/superadmin.guard.ts` — role check for the write routes.
- `src/users/schemas/user.schema.ts` — `role` field.
- `scripts/seed-sport-types.ts` — idempotent seeder, dry-run by default.
- `src/events/events.service.ts` — inherit-on-create, guard-on-update,
  `applyGroupSportType`, template check.
- `src/groups/groups.service.ts` — create/update validation + propagation.
- DTOs + schemas as described above.
