# Change Log — 2026-09-03 · `GET /events` hides finished events

**Branch:** `events-feature-spec`
**Tests:** 878 passing across 41 suites · build clean

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
