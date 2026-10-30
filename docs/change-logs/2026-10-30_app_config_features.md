# 2026-10-30 — App config: feature flags

The app config gains a `features` field, served to the apps in
`GET /configuration` under `config` and saved through the superadmin `POST` /
`PATCH /app-config`.

```json
{
  "features": { "tournament": true, "groupChallenge": false }
}
```

- **`features`**: switches the apps use to show or hide a feature. Any flag
  left out is `false`. On `PATCH`, flags you leave out keep their value.

Revisions saved before this change have no `features`. They are read as every
feature off, so **a superadmin must `PATCH` the flags on** before the apps show
them.
