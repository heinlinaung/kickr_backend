# 2026-10-29 — Tournament formats: league, knockout, mixed

A tournament now runs as **LEAGUE**, **KNOCKOUT** or **LEAGUE_KNOCKOUT**
(group stage, then a bracket). The organizer picks the format and its settings,
draws groups, generates fixtures, records results, and the server keeps the
standings, runs qualification and moves winners through the bracket.

All responses below are the payload inside the standard `{ "data": … }`
envelope. All endpoints need a JWT. Writes need the **organizer** (the user who
created the tournament) and otherwise fail with `403 NOT_ORGANIZER`; reads are
open to anyone who can see the tournament. Errors carry a `code` to switch on.

---

## Endpoints

| Method | Path                                         | Purpose                                          |
| ------ | -------------------------------------------- | ------------------------------------------------ |
| PUT    | `/tournaments/:id/format`                    | Set format and all phase settings (+ preview)    |
| PATCH  | `/tournaments/:id/status`                    | Open/close registration, back to draft, cancel   |
| POST   | `/tournaments/:id/teams/:teamId/withdraw`    | Withdraw a team (rules below)                    |
| POST   | `/tournaments/:id/league/draw`               | Put teams into groups (random, seeded, manual)   |
| GET    | `/tournaments/:id/league/groups`             | Groups and their teams                           |
| POST   | `/tournaments/:id/league/fixtures`           | Generate round-robin fixtures                    |
| POST   | `/tournaments/:id/phases/:phase/start`       | `league` or `knockout`                           |
| GET    | `/tournaments/:id/standings?group=A`         | Standings, all groups or one                     |
| PATCH  | `/matches/:matchId/result`                   | Save a score (penalties in knockout)             |
| GET    | `/tournaments/:id/qualification`             | Who qualified, open ties, the proposed bracket   |
| POST   | `/tournaments/:id/qualification/resolve`     | Organizer breaks an unbreakable tie              |
| POST   | `/tournaments/:id/knockout/bracket`          | Generate, lay out by hand, or confirm            |
| GET    | `/tournaments/:id/bracket`                   | The bracket, round by round                      |

`PATCH /tournaments/:id/status` and `/withdraw` are additions to the spec: the
lifecycle needs a way to open/close registration and cancel, and the edge-case
rules need a way to withdraw a team.

### Changed

- `POST /tournaments` takes `format` (default `KNOCKOUT`). `type` still works
  (`knockout` / `league`) but is deprecated. A new tournament starts in
  `REGISTRATION_OPEN`, as before, with default settings for its format.
- `POST /tournaments/:id/teams` accepts optional `clubId` (the Group the team
  comes from), used by `separateSameClub`.
- **Removed** `PATCH /tournaments/:id/matches/:matchId` — nothing ever created
  matches for it. Use `PATCH /matches/:matchId/result`.
- `GET /tournaments/:id` returns the same `{ tournament, teams, matches }`;
  `tournament` now has `format`, `settings`, `placements`, and `matches` use
  the new shape (`homeTeamId`, `awayTeamId`, `homeGoals`, …).
- `tournament.status` uses the new lifecycle (below). **Run
  `scripts/migrate-tournament-formats.ts` before deploying** — old values
  (`registering`, `ongoing`, `finished`) no longer validate.

---

## Lifecycle

`DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → LEAGUE_IN_PROGRESS →
QUALIFICATION_REVIEW → KNOCKOUT_IN_PROGRESS → COMPLETED` (or `CANCELLED`).
Phases the format doesn't use are skipped.

| How it moves                                   | To                     |
| ---------------------------------------------- | ---------------------- |
| `PATCH status` (DRAFT ↔ OPEN ↔ CLOSED, cancel) | as asked               |
| League draw, or knockout-only bracket          | `REGISTRATION_CLOSED`  |
| `POST phases/league/start`                     | `LEAGUE_IN_PROGRESS`   |
| Last league result saved (mixed)               | `QUALIFICATION_REVIEW` |
| `POST phases/knockout/start`                   | `KNOCKOUT_IN_PROGRESS` |
| Final (and third-place match) decided          | `COMPLETED`            |
| Last league result, no tie in top 3 (league)   | `COMPLETED`            |

Reopening registration from `REGISTRATION_CLOSED` clears the draw and bracket.

---

## PUT /tournaments/:id/format

```json
{
  "format": "LEAGUE_KNOCKOUT",
  "league": {
    "groupCount": 3,
    "teamsPerGroup": 4,
    "roundRobin": "SINGLE",
    "points": { "win": 3, "draw": 1, "loss": 0 },
    "groupDraw": "RANDOM",
    "separateSameClub": true,
    "tiebreakers": ["H2H_POINTS", "H2H_GOAL_DIFF", "GOAL_DIFF", "GOALS_FOR", "FAIR_PLAY", "LOTS"]
  },
  "qualification": { "qualifyPerGroup": 2, "bestOfRest": 2, "seeding": "CROSS_GROUP" },
  "knockout": { "legs": 1, "drawResolution": "PENALTIES", "thirdPlaceMatch": true },
  "confirm": false
}
```

Every setting is optional and defaults as in the spec; `knockout.bracketSeeding`
(`RANDOM_DRAW` | `MANUAL`) applies to knockout-only. Response:

```json
{
  "format": "LEAGUE_KNOCKOUT",
  "league": { … }, "qualification": { … }, "knockout": { … },
  "status": "REGISTRATION_OPEN",
  "drawReset": false,
  "preview": {
    "teamCount": 12, "groups": 3, "teamsPerGroup": [4, 4, 4],
    "qualifiers": 8, "byes": 0,
    "matches": { "league": 18, "knockout": 8, "total": 26 },
    "knockoutStartsAt": "Quarter-final"
  },
  "suggestions": [ { "format": "LEAGUE_KNOCKOUT", "league": { "groupCount": 4 }, … } ]
}
```

- `league` is omitted for KNOCKOUT; `qualification` and `knockout` for LEAGUE.
- The preview counts approved teams, or `maxTeams` while fewer than 2 are approved.
- `suggestions` are the recommended setups for that team count (the spec's table).
- When it can change:
  - before any phase starts: freely; an existing draw/bracket is cleared (`drawReset: true`).
  - `LEAGUE_IN_PROGRESS`: only with `confirm: true` and no league result yet;
    goes back to `REGISTRATION_CLOSED`, redraw needed.
  - `QUALIFICATION_REVIEW`: only seeding and knockout settings; qualification reruns.
  - `KNOCKOUT_IN_PROGRESS`: only knockout settings, with `confirm: true`, no knockout result yet.
  - otherwise `409 FORMAT_LOCKED`.
- `400 INVALID_FORMAT_SETTINGS`: more groups than teams (min 2 per group),
  fewer than 2 qualifiers, `qualifyPerGroup` (+1 with `bestOfRest`) larger
  than the smallest group, `bestOfRest` with one group or more than one per group.

---

## League

**`POST /league/draw`** — `{ "method"?, "pots"?, "groups"?, "separateSameClub"? }`

- `RANDOM` (default from settings): shuffled as evenly as possible (10 teams / 3 groups → 4,3,3).
- `SEEDED`: `pots: [[ids…], [ids…]]`, pot 1 strongest, each pot at most one team per group.
- `MANUAL`: `groups: [[ids…], [ids…]]`, one array per group, in order A, B, C.
- Every approved team exactly once, ≥ 2 per group (`409 NOT_ENOUGH_TEAMS`).
- Replaces any earlier draw and its fixtures; closes registration.
- A single table is named `League`; groups are `A`, `B`, `C`…

Returns the same body as `GET /league/groups`:

```json
{ "drawn": true, "groups": [ { "id": "…", "name": "A", "teams": [ { "teamId": "…", "name": "Red", "withdrawn": false, "pot": null, "drawOrder": 1 } ] } ] }
```

**`POST /league/fixtures`** — circle-method round-robin per group (n×(n−1)/2
matches, doubled for `DOUBLE`), odd groups rest one team per matchday. The
fixtures are ordered (`sequence`) so no team plays twice in a row when that can
be avoided. `409 DRAW_NOT_DONE` without a draw. Returns the match list.

**`GET /standings?group=A`**

```json
{ "groups": [ { "id": "…", "name": "A", "standings": [
  { "teamId": "…", "name": "Red", "played": 3, "won": 3, "drawn": 0, "lost": 0,
    "goalsFor": 6, "goalsAgainst": 0, "goalDiff": 6, "points": 9,
    "fairPlay": 1, "rank": 1, "tied": false }
] } ] }
```

`tied: true` marks teams no tiebreaker separates (expect this for everyone
before the first result). `fairPlay` = yellow ×1 + red ×3, lower is better.
Tiebreakers: head-to-head points, head-to-head goal difference (recomputed among
just the teams still level), goal difference, goals for, fair play, lots (an
organizer ruling). Standings are computed from results and cached per group.

---

## Results — PATCH /matches/:matchId/result

```json
{ "homeGoals": 2, "awayGoals": 2, "penalties": { "home": 4, "away": 3 },
  "cards": { "home": { "yellow": 1, "red": 0 }, "away": { "yellow": 2, "red": 0 } } }
```

or a forfeit: `{ "forfeit": "AWAY" }` (the side that didn't show) → 3–0 in the
league, walkover in the knockout.

- League: `penalties` → `400 PENALTIES_NOT_ALLOWED`; a draw is a draw.
  Editable until the knockout starts (`409 RESULT_LOCKED`).
- Knockout: a level score needs `penalties` with a winner, else `400
  KNOCKOUT_NEEDS_WINNER`; penalties with a non-level score are rejected. The
  winner moves into the next match (and a semi-final loser into the
  third-place match). Editable until the next-round match has a result
  (`409 RESULT_LOCKED`); the next match is updated if the winner changes.
- Two legs: leg 1 takes no penalties; leg 2 needs leg 1 first (`409
  MATCH_NOT_READY`) and is decided on aggregate (no away-goals rule). The
  final and third-place match are always one leg.
- Byes, void matches and matches still waiting for a team → `409 MATCH_NOT_READY`.

---

## Qualification (mixed) — GET /qualification

```json
{
  "status": "REVIEW",
  "qualifiers": [ { "teamId": "…", "name": "Red", "seed": 1, "seedLabel": "A1", "rank": 1, "tier": 0, "fromGroupId": "…" } ],
  "ties": [],
  "bracket": { …same as GET /bracket… }
}
```

`status`: `PENDING` (league not done), `TIE_UNRESOLVED`, `REVIEW`, `CONFIRMED`.
For LEAGUE tournaments it returns `{ status, placements, ties }` instead.

- Runs automatically when the last league result is saved, and again after any
  edit, ruling or withdrawal while in review.
- Seeding: `CROSS_GROUP` ranks winners, then runners-up, then best-of-rest
  across groups, pairs 1 v last, and swaps opponents (same tier first) so no
  first-round match pairs two teams from one group. Pairs it can't fix are
  listed in the bracket's `clashes`. `RANKED` ranks all qualifiers together.
  `RANDOM_DRAW` draws at random. `MANUAL` needs `order` (below).
- Teams compared across groups of different sizes drop their results against
  the bottom team(s) of the bigger group first.
- A tie **blocks** only where it decides something: a group position up to the
  cut (and the next place when `bestOfRest` looks at it), or the best-of-rest
  cut. Then the bracket isn't built and `ties[]` lists `{ teamIds, teams,
  groupId, reason }`.

**`POST /qualification/resolve`** — `{ "order": [teamIds best first], "reason": "Drawing of lots" }`.
`order` must be exactly the teams of one open tie (`400 INVALID_REQUEST` lists
the open ties otherwise). The ruling is stored and shown on the qualifier
(`resolvedBy`, `reason`).

---

## Bracket

**`POST /knockout/bracket`**

| Body                         | Effect                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| `{}`                         | (Re)generate from the seeding                              |
| `{ "order": [...] }`         | Lay out round one by hand (MANUAL, or adjusting clashes)   |
| `{ "confirm": true }`        | Confirm (generates first if there is none)                 |

`order` has one entry per bracket position (team count rounded up to a power of
2), `null` for a bye; positions (0,1), (2,3)… are the first-round matches.
Mixed: only in `QUALIFICATION_REVIEW`, `409 UNRESOLVED_TIE` while a tie is
open. Knockout-only: draws from approved teams and closes registration.

**`GET /bracket`**

```json
{
  "confirmed": true,
  "clashes": [],
  "rounds": [
    { "id": "…", "name": "Semi-final", "matches": [
      { "id": "m_21", "slot": 1, "home": { "teamId": "t_red", "name": "Red", "seed": "A1" },
        "away": { "teamId": "t_lions", "name": "Lions", "seed": "B2" },
        "score": null, "status": "SCHEDULED", "winnerTeamId": null, "winnerTo": "m_31.home" }
    ] },
    { "id": "…", "name": "Final", "matches": [ { "id": "m_31", "slot": 1, "home": null, "away": null, "score": null, "winnerTo": null } ] }
  ],
  "thirdPlace": { …match, or null… }
}
```

- A bye is `"away": { "bye": true }`; its team is already in round two.
- `score` is `{ home, away, penalties?: { home, away }, forfeit? }`.
- Two-legged ties show the aggregate as `score` plus `legs: [{ id, leg, score, status }, …]`;
  post each leg's result to its own `id`.
- Without a third-place match both semi-final losers get place 3 in `placements`.

---

## Starting phases — POST /phases/:phase/start

- `league`: needs the draw (`DRAW_NOT_DONE`) and fixtures (`PHASE_NOT_READY`).
- `knockout` (mixed): needs `QUALIFICATION_REVIEW`, no open tie
  (`UNRESOLVED_TIE`) and a confirmed bracket (`PHASE_NOT_READY`).
- `knockout` (knockout-only): needs a generated bracket.

---

## Withdrawals — POST /tournaments/:id/teams/:teamId/withdraw

| When                         | What happens                                               |
| ---------------------------- | ---------------------------------------------------------- |
| Before the league / bracket  | Draw and bracket cleared (`drawReset: true`); redraw       |
| League, < half played        | All its results removed; it leaves the table               |
| League, ≥ half played        | Its remaining matches become 3–0 for the opponents         |
| Qualification review         | Next-ranked team in its group takes its place              |
| Knockout                     | Walkover to its opponent (now, or when the opponent arrives) |

---

## Error codes

| Code                        | HTTP | When                                                     |
| --------------------------- | ---- | -------------------------------------------------------- |
| `NOT_ORGANIZER`             | 403  | Caller isn't the tournament organizer                    |
| `INVALID_FORMAT_SETTINGS`   | 400  | Settings can't work; phase the format doesn't have       |
| `INVALID_REQUEST`           | 400  | Bad pots/groups/order, wrong tie, missing goals          |
| `FORMAT_LOCKED`             | 409  | Changing format/draw after a phase started               |
| `NOT_ENOUGH_TEAMS`          | 409  | < 2 approved per group, < 2 for knockout                 |
| `DRAW_NOT_DONE`             | 409  | Fixtures or league start before the draw                 |
| `PHASE_NOT_READY`           | 409  | Phase started before the previous one is done            |
| `UNRESOLVED_TIE`            | 409  | Bracket while a qualification tie is open                |
| `KNOCKOUT_NEEDS_WINNER`     | 400  | Level knockout score without decisive penalties          |
| `PENALTIES_NOT_ALLOWED`     | 400  | Penalties in the league, a first leg, or a decided score |
| `RESULT_LOCKED`             | 409  | Edit after the next round was played                     |
| `MATCH_NOT_READY`           | 409  | Bye, void match, team missing, leg 1 not played          |
| `INVALID_STATUS_TRANSITION` | 409  | Status change not allowed (or a concurrent change)       |
| `TOURNAMENT_NOT_FOUND` / `TEAM_NOT_FOUND` / `MATCH_NOT_FOUND` / `GROUP_NOT_FOUND` | 404 | |

---

## Not done

- **Registration approval** (Pending → Approved, from the Team & Tournament
  spec) still doesn't exist: registering adds the team as `APPROVED`. The
  registration `status` field is ready for it, and every format endpoint
  already counts only approved teams.
- `drawResolution: EXTRA_TIME_THEN_PENALTIES` is stored but has no effect on
  the result format; the score you post is the score after extra time.
- Kickoff times aren't scheduled; `kickoffAt` is null and `sequence` gives the play order.
