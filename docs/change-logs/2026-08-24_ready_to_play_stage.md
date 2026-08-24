# Change Log — 2026-08-24

**Branch:** `events-feature-spec`
**Tests:** 699 passing across 36 suites · build clean
**Verified:** unit only — the transition table is exhaustively tested (36 ordered
pairs), but this has **not** been exercised against a real MongoDB or a live
client. See §5.

One item: the `ready_to_play` stage from
[2026-08-20_events_and_user_changes.md](./2026-08-20_events_and_user_changes.md).

---

## ⚠️ Before releasing — this breaks "start match"

**No database migration is needed.** That is worth saying plainly, because the
last lifecycle change did need one. Nothing stored becomes invalid here: no
existing event can hold `ready_to_play`, and every current value stays legal.
The break is in the *transition a client asks for*, not in the data.

**`preparation → playing` now returns `409`.** Any client with a "start match"
button on the team-assignment screen stops working until it routes through the
new state. There is no compatibility shim — see §2 for why.

---

## 1. What changed

A sixth lifecycle state sits between `preparation` and `playing`:

```
join → preparation → ready_to_play → playing → after_match → done
```

| From | To |
|---|---|
| `join` | `preparation` |
| `preparation` | **`ready_to_play`**, `join` (reopen registration) |
| `ready_to_play` | `playing`, **`preparation`** (re-shuffle) |
| `playing` | `after_match` |
| `after_match` | `done` |
| `done` | — terminal |

Seven edges over six states. The spec doc lists the flow as
*Joined → Preparation → Ready to Play → Playing → Result → Done*; `Result` is
the existing `after_match` state, **not renamed** — see §4.

## 2. Why `preparation → playing` had to go

Keeping the old edge as a shortcut was the obvious compatibility move, and it
was rejected on purpose.

`before_match` was deleted on 2026-08-18 for gating nothing: the same actions
were permitted either side of it, so it was a label an event passed through. A
`ready_to_play` that can be bypassed is the same mistake — the roster freeze
below only means anything if kick-off has to pass through the state that
enforces it.

So the new state earns its place by gating something real:

| | `preparation` | `ready_to_play` |
|---|---|---|
| build / shuffle teams | ✅ | ❌ `400` |
| enter a score | ❌ | ❌ |
| view final teams | ✅ | ✅ |

`ready_to_play` is "the line-up is final, we have not kicked off". Coming from
`preparation`, the roster stops moving; going into `playing`, scoring opens.
Joining and leaving already closed back in `join`, so once teams are reviewed
nothing underneath them can change.

## 3. The reverse edge

`ready_to_play → preparation` exists so a reviewed-but-wrong team set can be
sent back to be re-shuffled.

This is safe in a way no later reverse edge would be: scoring cannot have
started yet, so going back cannot discard a score. (Contrast the documented
behaviour in `preparation`, where re-submitting teams regenerates fixtures
wholesale.) There is deliberately no `ready_to_play → join` — reopening
registration is two deliberate steps, not one.

## 4. What was left alone

- **`after_match` was not renamed to `result`.** The spec doc calls stage 5
  "Result", and the code calls it `after_match`. Renaming it is a second
  breaking change to every client that string-matches the value, for no
  behavioural gain, and it was not what this task asked for. Flagged rather
  than done.
- **The 15-minute pre-match countdown** in the spec doc is a notifications
  feature, not a lifecycle one. Not touched.
- **Guest players (`+1`/`+2`), followers, and profile counts** from the same
  spec doc are separate features. Not touched.
- **`docs/change-logs/2026-08-18.md`** still says "5 states / 25 ordered
  pairs". That was accurate on the day; history was not rewritten.

## 5. Testing

`events.lifecycle.spec.ts` transcribes the intended table as data
independently of the implementation, then asserts **every one of the 36 ordered
pairs** — so adding an edge to the implementation without updating the
transcription fails the suite. New assertions worth naming:

- `preparation → playing` is refused, and absent from `allowedTransitions`
- the full forward path, one step at a time
- `ready_to_play → preparation` legal, `ready_to_play → join` not
- the roster freeze: `canShuffle('ready_to_play') === false`, with join/leave
  also closed
- score entry still refused in `ready_to_play`

At the service boundary, `shuffleTeams` is now asserted to reject in every
state except `preparation` (it previously spot-checked `playing` only), and the
admin `/admin/test-data` walkthrough goes through the new state and asserts the
freeze there.

**Not verified:** no run against a real MongoDB, and no live client. The
previous lifecycle change was verified 11/11 end-to-end before shipping; this
one has not had that pass.

## 6. Files

| File | Change |
|---|---|
| `src/events/events.lifecycle.ts` | New state, transition table, `canShuffle` note |
| `src/events/events.lifecycle.spec.ts` | Table transcription + new assertions |
| `src/events/events.service.lifecycle.spec.ts` | Happy path walks the new state |
| `src/events/events.service.teams.spec.ts` | Shuffle/score gates cover it |
| `src/events/events.controller.ts` | Swagger: sequence, filter values, 409 note |
| `src/events/dto/update-event-status.dto.ts` | Comment (enum is derived) |
| `src/admin/test-data.service.ts` | Walkthrough routes through the new state |
| `docs/api/events-api.md` | Banner, §3 tables, gotchas |
| `docs/api/README.md` | Breaking-change entry |

`Event.status` needed no schema edit — its enum reads `EVENT_STATUSES`, so it
picked the value up automatically.
