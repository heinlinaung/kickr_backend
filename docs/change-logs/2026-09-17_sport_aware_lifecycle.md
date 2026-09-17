# 2026-09-17 — sport-aware event lifecycle

## What changed

The event status lifecycle now depends on the event's `sportType`.

### Football (and events with no sportType stored) — unchanged

```
join -> preparation -> ready_to_play -> playing -> after_match -> done
```

Reverse edges: `preparation -> join`, `ready_to_play -> preparation`.

### Every other sport — `preparation` removed

```
join -> ready_to_play -> playing -> after_match -> done
```

Reverse edge: `ready_to_play -> join` (reopens registration — there is no
build stage to fall back to).

## Semantics

- `PATCH /events/:id/status` validates against the table for the EVENT's
  sport. `join -> preparation` on e.g. a badminton event is a **409** naming
  the sport ("Cannot move a badminton event from 'join' to 'preparation'") —
  `preparation` is still a recognised status (it stays in the schema enum and
  in query-filter validation), just not reachable for that sport.
- **Team building moves with the lifecycle**: football builds teams in
  `preparation` (and `ready_to_play` stays a frozen-roster review stage);
  every other sport builds them in `ready_to_play`, its only state between
  registration and kick-off. `canShuffle` / the three team endpoints gate on
  the sport's build stage, and their 400s name it.
- The teams-final push notification still fires on entering `ready_to_play`
  for all sports.
- **Stranded events can escape**: if a group's sportType changes away from
  football while an event sits in `preparation` (propagation keeps the
  status), the non-football table keeps EXIT edges from `preparation`
  (`-> ready_to_play`, `-> join`) but no entry edges.

## Exports (`src/events/events.lifecycle.ts`)

- `FOOTBALL_EVENT_STATUSES` (= `EVENT_STATUSES`, the superset) and
  `NON_FOOTBALL_EVENT_STATUSES`.
- `statusesFor(sportType)`, `isFootball(sportType)`,
  `buildStageFor(sportType)`.
- `canTransition(from, to, sportType?)`, `allowedTransitions(from,
  sportType?)`, `canShuffle(status, sportType?)` — the sport param is
  optional and defaults to football, so pre-existing callers are unchanged.

A missing/undefined sportType counts as football: it is the schema default,
so only pre-field documents read via `.lean()` lack it, and those all predate
other sports.

## Client impact

- Non-football events: send `ready_to_play` where you previously sent
  `preparation`; the status stepper has five stages, not six.
- Team generate/edit/shuffle for non-football events is done during
  `ready_to_play`.
- Football clients: no change.
