# 2026-10-13 — GET /configuration (one startup call)

## What changed

New public endpoint (no token) that returns everything the apps load at
startup in one call:

```json
{
  "data": {
    "config": { "revision": 3, "appUpdate": { … }, "majorUpdate": { … }, "createdAt": "…" },
    "regions": { "myanmar": [{ "id": "yangon", "name": "Yangon" }], "thailand": [ … ] },
    "sportTypes": [{ "value": "football", "subTypes": ["futsal", "stadium"], "sortOrder": 1, "matchProvided": false }]
  }
}
```

- `config` is the latest app config revision. It is `null` (not a 404) until
  a superadmin saves the first one.
- `regions` are keyed by country id, with countries in display order.
- `sportTypes` are in display order.

## Removed

These are replaced by `GET /configuration`:

| Method | Path | Now read from |
| --- | --- | --- |
| GET | `/app-config` | `config` |
| GET | `/regions` | `regions` |
| GET | `/sport-types` | `sportTypes` |

The other routes stay: `GET /app-config/history[/:revision]`,
`GET /countries[/:id]`, `GET /sport-types/:value`, and all the superadmin
writes.

`GET /sport-types` used to be superadmin only. Its data is now public through
`GET /configuration`.
