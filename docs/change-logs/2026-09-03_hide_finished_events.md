# Change Log — 2026-09-03 · `GET /events` hides finished events

**Branch:** `events-feature-spec`
**Tests:** 884 passing across 41 suites · build clean

> A second, unrelated fix landed the same day and has its own section below:
> the shuffle no longer discards team names.

`GET /events` no longer returns events whose status is `after_match` or `done`.

---

## 1. Why `after_match` counts as finished

The ask named both states, and they belong together: in `after_match` the match
has been **played** and only the result is outstanding. A discovery list
showing it is offering the user a fixture they cannot turn up to.

`done` was already the obvious case. Grouping them is what the new
`FINISHED_STATUSES` constant records.

## 2. An explicit `?status=` still wins

```
GET /events                      → hides after_match and done
GET /events?status=done          → returns done events
GET /events?status=after_match   → returns after_match events
```

Hiding by default must not make them unreachable, or a history screen has no
query left to run. This mirrors the rule `GET /events/joined` already used, so
the two routes behave the same way about explicit asks.

## 3. The exclusion is ANDed, not substituted

The default sits alongside the `?region=`, `?from=`/`?to=` and `?near=`
narrowings rather than replacing them — a region-filtered call still hides
finished events. A test covers this, because a filter that silently replaces
another is the kind of bug that only shows up in one query combination.

## 4. Deliberately scoped to this one route

`search()`, `listByGroup()` and `listJoined()` still hide **`done` alone** and
continue to show `after_match`.

That was a decision, not an oversight: narrowing the discovery list was the
ask, and a player looking at their own fixtures — or a group's schedule — has
more reason to see a match still awaiting its score. The four lists therefore
disagree about `after_match`. The reasoning is recorded at the call site so it
does not read as drift, and they should be revisited together if they need to
agree.

## 5. `FINISHED_STATUSES` lives in the lifecycle module

Added to `events.lifecycle.ts` — the pure, I/O-free module that already owns
`EVENT_STATUSES` and the transition table — rather than inlined as a `$nin` in
the service. Two lists that each hardcode their own idea of "finished" drift;
one named constant cannot.

It ships with `isFinished()` for callers that want the predicate rather than
the array.

## 6. Two stale tests, and what they were asserting

Two existing specs asserted `eventModel.find` was called with exactly
`{ isPublic: true }`. They failed, correctly — the filter now also carries the
status exclusion.

They were updated to assert the full filter rather than patched to pass. Four
new tests cover the behaviour directly:

- finished states are excluded by default
- each of `after_match` / `done` is still returned when asked for explicitly
- the exclusion does **not** widen to `join`, `preparation`, `ready_to_play` or
  `playing` — a guard against someone adding a live state to
  `FINISHED_STATUSES`
- the exclusion survives alongside a `?region=` narrowing

**Verified by reverting:** with the one-line change removed, 5 of these fail;
restored, all 25 in the suite pass. Tests that cannot fail prove nothing.

## 7. Unchanged

There is still **no default date filter** on this route. A past-dated event
whose status is `join` or `playing` is returned, and `?from=` remains the way
to narrow that. Only the status default changed.

---

# Addendum — `POST /events/:id/shuffle` preserves team names

Found while answering "is shuffle overwriting the existing teams' names?" — it
was.

## What it did

`shuffleTeams` called `createTeamsAndFixtures` **without `colors`**. That path
runs `teamModel.deleteMany({ eventId })` and then re-inserts from
`resolveTeamNames(dto)`, which with no `colors` falls back to
`TEAM_COLOURS.slice(0, teamsCount)`. So teams named `Lions`/`Tigers`/`Bears`
came back as `Red`/`Yellow`/`Blue`, silently, with nothing in the response
saying so.

This is the **same shape as the `duration` clobber** fixed on 2026-09-02: the
shuffle takes no body, so it had no names of its own, and invented them rather
than reusing what was there. That fix did not extend to names.

## What it does now

`existingTeamNames()` reads the current names — deliberately **before**
`createTeamsAndFixtures` deletes them — and `namesForShuffle()` decides the
final list:

| Case | Result |
|---|---|
| Same count | Names kept as-is |
| Count grows | Keep all, pad from **unused** defaults |
| Count shrinks | Truncate |
| No teams yet | Full default palette (a genuine first-time default) |

Padding skips any default already taken. `{eventId, name}` is **uniquely
indexed**, so padding `['Red','Yellow']` with `Red` would fail the insert, not
just look wrong. There is also a `Team N` tail for the case where the requested
count exceeds the palette.

## What is NOT fixed

**Team `_id`s still change on every shuffle.** The rows are deleted and
recreated, so a client holding a `teamId` for
`PATCH /events/:id/teams/:teamId` has a stale id afterwards. Preserving
identities would mean updating rows in place instead of delete-and-recreate —
a bigger change than the ask, and left alone deliberately. Documented as a
client-facing gotcha instead.

## Tests

Six new cases: custom names kept; padding on growth; padding never duplicates
an in-use name; truncation on shrink; palette fallback when nothing exists; and
that the name read happens **before** the delete — the ordering is the whole
fix, so it is asserted directly rather than assumed.

**Verified by reverting:** removing the one-line `colors:` carry-over fails 3 of
the 6. The other 3 cover fallback and ordering, which hold either way — worth
stating, since a test that cannot fail proves nothing.

Six existing tests also failed on the way, all `teamModel.find(...).select is
not a function`: their doubles stubbed only `.lean()` while the real chain is
`.find().select().sort().lean()`. **This is the fourth time on this branch** a
mock that ignored the real query shape hid a change — the pattern is now worth
treating as a standing hazard rather than a series of accidents.
