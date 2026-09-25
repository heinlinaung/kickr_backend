# 2026-09-25 — shuffle fixtures: max 2 consecutive matches per team

## The bug

Matches run one after another on a single pitch, so the fixture order is
also the rest schedule — and the shuffle's schedule gave the first team no
rest at all. With 4 teams (say Red, White, Blue, Green) it opened:

```
1. Red vs White
2. Red vs Blue
3. Red vs Green   <- Red's THIRD match in a row
```

The round-robin was generated pair-by-pair in nested order — team 1 against
everyone, then team 2 against everyone after it, and so on — so the first
team played `teamCount - 1` matches back to back.

## The rule

**No team plays more than 2 consecutive matches.** Red vs White followed by
Red vs Blue is fine; a third straight Red match is not.

## The fix

Fixtures are now ordered by the classic **circle method**: the round-robin
is built round by round, and no team appears twice within a round. Any three
consecutive fixtures therefore always include two from the same round, so no
team can be in all three — the streak cap falls out of the construction
rather than being patched afterwards.

The guarantee holds everywhere a schedule has a seam:

- **Within leg 1 and leg 2** of the double round-robin, and across the
  boundary between them (leg 2 replays leg 1's order with home/away
  swapped).
- **Across the repeat seam** when a long event repeats the round-robin to
  fill the booked slot (last fixture of one cycle → first of the next).
- **Under truncation** — a prefix of a valid order is still valid.

`MAX_CONSECUTIVE_MATCHES = 2` is exported from `events.fixtures.ts` so the
rule has one home.

## Exemption

**2 teams**: both teams necessarily play every match, so no ordering can
satisfy the cap. Two-team schedules still alternate home and away as before.

## What did NOT change

- Fixture COUNT and pairings: still a double round-robin (every pair meets
  twice, once each way), still repeated to fill the slot, still
  `floor((duration - 10) / matchDuration)` slots.
- Every team still plays the same number of matches, leg 1 still completes
  before leg 2 begins (no early rematches), and `matchNumber` still runs
  1..N.
- API shapes: `POST /events/:id/shuffle`, `POST /events/:id/teams` and the
  match list respond exactly as before — only the ORDER of the rows differs.

## Client impact

None required. Clients that display the fixture list already render it in
`matchNumber` order and simply show the fairer schedule.
