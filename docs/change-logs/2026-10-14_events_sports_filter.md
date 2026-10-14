# 2026-10-14 — GET /events ?sports= filter

The event listing now filters by sport:

```
GET /events?sports=football,badminton
```

- Comma-separated values from the `sporttypes` collection
  (GET /sport-types); entries are trimmed and lowercased, empties dropped.
- Matches the EVENT's own `sportType`; an event WITHOUT one (rows
  written before the field existed) falls back to its GROUP's sportType.
- Filter semantics, like `?region=`: an unknown value matches nothing
  rather than erroring.
- Composes with every existing param (region, near/radius, from/to,
  status, includeExpired) and with the visibility rules.

No deploy steps.
