# 2026-09-19 — MVP gets its own endpoint (`POST /events/:id/mvp`)

## What changed

Submitting the MVP moved out of `POST /events/:id/result` into its own
endpoint:

```
POST /events/:id/mvp
{
  "userId": "USER_ID",   // the MVP player — must have joined this event
  "goal": 12             // goals scored by the MVP
}
```

- Same authority and window as the result: **organizer only**, **after_match
  only**.
- `userId` must be a joined player of the event (same rule the result
  endpoint enforced when it owned the field — a non-player MVP would corrupt
  the profile mvpCount).
- Both fields required; `goal` is an integer 0–200.
- New stored field `result.mvpGoal` (null on results recorded before it
  existed — "not reported", not zero).

## `POST /events/:id/result` no longer takes an MVP

- `mvpUserId` is gone from `SubmitResultDto`: a client still sending it gets
  a **400** naming the property (global `forbidNonWhitelisted` pipe), not a
  silent drop.
- The endpoint records only `scoreA`/`scoreB` now.
- **The two endpoints preserve each other's fields**: posting or correcting
  the score keeps an MVP recorded earlier, and posting the MVP keeps the
  score. Previously, re-submitting the result replaced the whole `result`
  subdocument — an MVP-less correction would have blanked the MVP; the split
  removes that trap.

## Client impact

- Send the MVP to the new endpoint; stop including `mvpUserId` in the result
  body (it is now a 400 there).
- MVP and score can be submitted in either order.
- Event reads now carry `result.mvpGoal` alongside `result.mvpUserId`.

No migration: existing results read `mvpGoal: null`.
