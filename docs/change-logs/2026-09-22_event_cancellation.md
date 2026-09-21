# 2026-09-22 — event cancellation (`POST /events/:id/cancel`)

## What changed

An organizer can cancel an event — an emergency, or not enough players to
start — with a reason every player sees.

```
POST /events/:id/cancel
{ "reason": "Pitch flooded — venue closed for the day" }   // required, ≤500 chars
```

Modelled as BOTH a new status and new fields, with distinct jobs:

- **`status: 'cancelled'`** — a second terminal lifecycle state. Everything
  that keys off status (gates, transition tables, list filters, the client's
  status-aware screen) treats a cancelled event as over without any
  bolt-on flag checks.
- **`cancelReason` / `cancelledAt` / `cancelledBy`** — the data about the
  cancellation. `cancelReason` is the message players see; all three are
  `null` on live events and written only by the cancel endpoint.

## Rules

- **Who**: organizer only (creator, or group owner/admin) — same authority
  as every lifecycle move.
- **From where**: any state up to and including `playing` (both sport
  tables) — the not-enough-players call comes before kick-off, the emergency
  call can come mid-match. NOT from `after_match`/`done`: a played match is
  history and must not be erasable. Cancelling twice is a 400 ("already
  cancelled").
- **Not via `PATCH /:id/status`**: `status=cancelled` there is a 400
  pointing at the cancel endpoint — that body has nowhere to carry the
  reason, and a reasonless cancellation is the half-record this design
  avoids.
- **Terminal**: `canModify` is false, so a cancelled event can no longer be
  edited or deleted; team chats are archived (readable, closed to new
  messages), same closure as `done`.

## Side effects

- **Every joined player is push-notified** — title "`<event>` is cancelled",
  body = the reason — the notification that most needs to reach a pocket:
  someone is about to travel to a match that will not happen. Notification
  failure never fails the cancellation.
- **The weekly plan slot is freed**: the events-per-week cap now counts
  `status != 'cancelled'`, same reasoning as deletion — the week was not
  used. A `done` event still counts.

## Where cancelled events (don't) appear

- **Hidden** from discovery (`GET /events` — `cancelled` joined
  `FINISHED_STATUSES`) and from search defaults, like other over fixtures.
- **Visible** in `GET /events/group/:id` and `GET /events/joined` — telling
  the people involved is the point; the row carries `cancelReason`.
- Reachable explicitly anywhere via `?status=cancelled`.

## Cancel vs delete

Delete makes the event vanish; cancel keeps the record and tells the roster
why. Once anyone has joined, cancel is almost always the right verb — the
Swagger docs on both endpoints now say so.

## Client impact

- New endpoint above; event reads carry `cancelReason`/`cancelledAt`/
  `cancelledBy` (null unless cancelled).
- The status stepper gains a terminal `cancelled` presentation; show
  `cancelReason` prominently on a cancelled event's detail screen.
- No migration: existing documents read the new fields as null.
