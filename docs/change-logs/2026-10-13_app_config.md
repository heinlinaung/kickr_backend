# 2026-10-13 — App config (update prompts) with history

## What changed

New `appconfigs` collection (`src/app-config/`) holding the `appUpdate` and
`majorUpdate` settings the iOS/Android apps read at startup.

Append-only: every write inserts a new document with the next `revision`
(1, 2, 3…). The highest revision is the live config; older ones are kept
unchanged as history. There is no DELETE endpoint.

| Method | Path | Auth | What |
| --- | --- | --- | --- |
| GET | `/app-config` | public (no token) | Latest config (`revision, appUpdate, majorUpdate, createdAt`). 404 until one is saved. |
| GET | `/app-config/history?limit=20&before=<revision>` | public (no token) | Revisions, newest first. Pass the last row's `revision` as `before` to page. |
| GET | `/app-config/history/:revision` | public (no token) | One revision. |
| POST | `/app-config` | superadmin | Full body → new latest revision. |
| PATCH | `/app-config` | superadmin | Only the fields to change, applied on top of the latest → new latest revision. |

Admin responses also carry `updatedBy` (the superadmin's user id).

### Body shape (POST)

```json
{
  "appUpdate": {
    "ios":     { "latestVersion": "1.0.1", "minimumVersion": "1.0.0", "upgradeTitle": "…", "upgradeDescription": "…", "forceUpdate": false },
    "android": { "latestVersion": "1.0.1", "minimumVersion": "1.0.0", "upgradeTitle": "…", "upgradeDescription": "…", "forceUpdate": false }
  },
  "majorUpdate": {
    "ios":     { "enabled": true, "title": "…", "description": "…", "version": "1.0.0" },
    "android": { "enabled": true, "title": "…", "description": "…", "version": "1.0.0" }
  }
}
```

PATCH example: `{ "appUpdate": { "ios": { "latestVersion": "1.0.2" } } }`.

### Validation

- Versions must be dotted numbers (`1.0.1`, `2.3`).
- `minimumVersion` may not be above `latestVersion` (compared numerically,
  so `1.10.0 > 1.9.2`) → 400.
- `forceUpdate` / `enabled` default to `false` when omitted on POST.

**Deploy step:** after release, a superadmin must `POST /app-config` once —
until then `GET /app-config` returns 404.

## Sport types: reads are superadmin only too

`GET /sport-types` and `GET /sport-types/:value` used to accept any signed-in
user; they now require `role: 'superadmin'` like the writes (403 otherwise).
Group/event/profile writes still validate `sportType` server-side, unaffected.
