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

- `GET /sport-types` returns the list in display order — the picker source.
- Each row's `subTypes` are the formats an EVENT of that sport may set as its
  `subType`. Only football has any.
- Groups and events store the plain `value` string, **not** an ObjectId ref.
- Adding a sport is now a seed-list edit + `npx ts-node
  scripts/seed-sport-types.ts --apply`, not a deploy.

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

## Client impact

- `GET /sport-types` (auth'd) is the new source for sport pickers, including
  per-sport `subTypes` for the event-format picker.
- Sending a sportType on a group event that differs from the group's is now a
  400 on both create and update.
- Unknown sports/formats still 400, but the message now lists valid values.

## Files

- `src/sport-types/` — schema, service, controller, module (pattern:
  `global-football-teams`).
- `scripts/seed-sport-types.ts` — idempotent seeder, dry-run by default.
- `src/events/events.service.ts` — inherit-on-create, guard-on-update,
  `applyGroupSportType`, template check.
- `src/groups/groups.service.ts` — create/update validation + propagation.
- DTOs + schemas as described above.
