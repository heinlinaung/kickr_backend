# 2026-09-22 — event cancellation (`POST /events/:id/cancel`) + restore

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

## Undoing a wrong cancellation — `POST /events/:id/restore`

```
POST /events/:id/restore     // no body
```

- Organizer-only, **cancelled events only** (anything else is a 400).
- Puts the event back in the status it held when cancelled — cancel now
  records `statusBeforeCancel`, so a match cancelled mid-`playing` resumes
  as `playing`, not at registration (`join` is the fallback for rows
  cancelled before the field existed).
- Clears `cancelReason`/`cancelledAt`/`cancelledBy`/`statusBeforeCancel`, so
  "cancelReason exists iff cancelled" stays true. This is also why the
  transition table keeps `cancelled` terminal and restore is its own
  endpoint: `PATCH /:id/status` could never clear the record.
- Team chats reopen (`archived: false`), and every joined player is
  notified: "<event> is back on" — they were just told the opposite.
- **Re-checks the creator's weekly plan slot**: cancelling freed it, and
  another event may have taken it since. If the week is full again,
  restoring is a 400 ("another event has taken the freed slot") — delete or
  cancel one of the others first.

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
