# 2026-09-22 — profile `sports` validate against the `sporttypes` collection

## What changed

`PATCH /users/me`'s `sports` array — and `preferredSport`, which drew from
the same list — now validate against the **`sporttypes` collection**, the
same source group and event `sportType` use.

Previously they were checked against a hardcoded `SPORT_TYPES` constant
(`src/users/profile.constants.ts`) that had already drifted: it never learned
about `badminton`, so a user could not list the sport their group and events
were allowed to use. That constant is removed; the DTO now only checks the
fields are strings, and `UsersService.updateProfile` does the value check
(one `findAll` covers the whole array).

## Behaviour

- Unknown values are a **400 naming the offender and the valid list**:
  `"Unknown sport 'cricket'. Valid values: football, futsal, badminton,
  padel, basketball"` (and likewise `Unknown preferredSport '…'`).
- Nothing is written when validation fails.
- Sending neither field costs no lookup; an empty `sports: []` clears the
  list without one.
- Newly valid vs the old enum: `badminton` (and anything seeded later —
  adding a sport is a seed re-run, no deploy).

## Client impact

- Populate the profile's sports picker from `GET /sport-types`, same as the
  group/event pickers.
- No migration: stored values were a subset of the collection already.
