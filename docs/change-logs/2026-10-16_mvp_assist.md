# 2026-10-16 — MVP assists on `POST /events/:id/mvp`

## What changed

`POST /events/:id/mvp` now takes the MVP's assist count alongside goals:

```
POST /events/:id/mvp
{
  "userId": "USER_ID",   // the MVP player — must have joined this event
  "goal": 12,            // goals scored by the MVP
  "assist": 3            // assists made by the MVP
}
```

- `assist` is **required**, an integer 0–200 (same rules as `goal`).
- New stored field `result.mvpAssist` (null on results recorded before it
  existed — "not reported", not zero).
- `POST /events/:id/result` preserves `mvpAssist`, as it already does for
  `mvpUserId` / `mvpGoal`.

## Client impact

- Send `assist` in the MVP body — omitting it is now a **400**.
- Event reads now carry `result.mvpAssist`.

No migration: existing results read `mvpAssist: null`.
