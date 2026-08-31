# Change Log — 2026-09-01

**Branch:** `events-feature-spec`
**Tests:** 840 passing across 40 suites · build clean
**Verified:** unit only. The behaviour this closes was found by running the real
API, and the fix has not itself been re-run against a database — see §5.

Closes the one gap left open by
[2026-08-31 §8](./2026-08-31_guest_players.md): an approved guest was on the
roster but could not be put in a team.

---

## 1. What was wrong

Reported from live use, twice, from two directions:

1. "Why did my guest not appear in `GET /events/:eventId/teams`?" — a shuffle of
   27 players and 1 approved guest returned three teams of 9 and no guest.
2. "So how can we know which team the guest is in?" — nowhere, as it turned out.

`team.players` is `[{ ref: 'User' }]` and a guest has no account, so there was
nothing to put in it. The shuffle deliberately excluded guests (a guest row has
no `userId`, so dealing one would have dereferenced `undefined`).

Worse, the `EventPlayer.team` string — the field that would otherwise have
answered question 2 — is written by an update keyed on
`userId: { $in: roster }`. A guest has no `userId`, so that update could never
reach a guest row and their `team` stayed `null` permanently. There was no
representation of a guest's team anywhere in the system.

## 2. The shape

A team's squad is now the **union of two fields**:

| Field | Holds | Why separate |
|---|---|---|
| `team.players` | registered players, by **user id** | unchanged |
| `team.guests` | approved guests, by **roster-row id** | a guest has no user id to store |

`team.guests` references `EventPlayer` rather than holding a name string, so a
team read still reaches the approval state and the sponsor — a team can show who
brought this person and whether they are still approved.

Reshaping `players` into a tagged array was rejected for the third time on this
branch, for the reason that keeps applying: `GET /events/:id/teams` populates it
straight into user objects, so changing it breaks the response for every client.
Annotating is the cheaper half of the trade, and the cost — two fields to keep
consistent — is paid in one place.

## 3. What changed

**`PATCH /events/:id/teams/:teamId`** takes an optional `guestIds`, validated on
the same terms as `playerIds`: each must be an approved guest on this event, no
duplicates, and none already in a sibling team.

**It replaces outright**, like `playerIds`. Omitting `guestIds` **clears** the
team's guests rather than leaving them, so one call fully describes the squad
and a stale client cannot silently preserve a guest it did not mean to keep.

**`numberOfPlayers` counts everyone.** The pre-existing size check ran against
registered players only; a team of 4 with a limit of 5 could have taken 2 guests
and quietly fielded 6. The check is now `players + guests` and the old
player-only check was removed rather than left to fire first with a misleading
message.

**The shuffle deals guests**, in a second pass rather than over a merged list —
the two halves land in different fields, so merging would mean tagging every id
and splitting again at the far end. Two consequences:

- `numberOfPlayers` is sized from the whole roster, `ceil((players + guests) /
  teams)`. Sizing off registered players alone would have set a limit the guests
  then breached — the same bug as above, one layer up.
- Guests count toward the two-player minimum, so one registered player plus two
  approved guests is now shuffleable.

**`EventPlayer.team` is stamped for guests**, keyed on the roster-row `_id`. This
is what makes "which team is this guest in?" answerable from the guest's own row.
Without it a guest would sit in `team.guests` while their row read `team: null` —
two sources of truth disagreeing, which is the state I argued against shipping
when the partial fix was on the table.

A **guest-only team** counts as `ready`, since `status` tracks whether anyone is
assigned, not whether they hold accounts.

## 4. Test-double fallout worth noting

The shuffle now makes **two** roster queries where it made one, and the existing
doubles answered any `playerModel.find` with the same rows — so the guest lookup
received player documents and four unrelated shuffle tests failed. The shared
double now branches on `query.type`, with an `onlyPlayers` helper for the tests
that override it.

That is a small thing, but it is the second time this week a mock that ignored
its query argument hid a real behavioural change. A double that answers every
query identically cannot fail when a new query is added.

## 5. Testing

11 new tests. Guests persisted by roster-row id; `EventPlayer.team` stamped via
an `_id`-keyed update; an unapproved guest refused; the squad limit counting both
halves; a guest already in another team refused by name; omitted `guestIds`
clearing; a guest-only team `ready`; and on the shuffle — guests dealt across
teams, counted toward the minimum, and sized into `numberOfPlayers`.

**Not verified:** this has not been run against a real database. The two live
reports in §1 are what surfaced the gap, and the same route should be re-run to
confirm the guest now appears in `GET /events/:eventId/teams` with a `team` value
on their roster row. The `partialFilterExpression` index from 2026-08-31 also
remains unexercised — adding a **second** guest to one event is still the check.

## 6. Files

| File | Change |
|---|---|
| `src/events/schemas/team.schema.ts` | `guests` |
| `src/events/dto/assign-team-players.dto.ts` | `guestIds` |
| `src/events/events.service.ts` | `approvedGuestIds`, guest validation and persistence in `assignTeamPlayers`, guest-keyed `EventPlayer.team` write, guest dealing in `shuffleTeams`, `listTeams` populate |
| `src/events/events.service.teams.spec.ts` | 11 tests, query-aware roster double |
| `docs/api/events-api.md` | §13.8, three gotchas, §13.7 trimmed |
| `docs/api/README.md` | 2026-09-01 note |
