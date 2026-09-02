# Change Log — 2026-09-02

**Branch:** `events-feature-spec`
**Tests:** 841 passing across 40 suites · build clean
**Verified:** unit only — the shuffle bug was found in live use, and the fix has
not been re-run against a database. See §5.

Two changes to `duration`, one bug and one relocation. **The match count is
deliberately unchanged** — see §3.

---

## 1. The shuffle no longer overwrites the organizer's duration

**Reported:** generate with `{ teamsCount: 3, duration: 15 }` on a 90-minute
event, then shuffle, and the stored duration came back as **26**.

`shuffleTeams` takes no body, so it had no duration of its own — and invented
one:

```ts
floor((event.duration - MATCH_BUFFER_MINUTES) / DEFAULT_SHUFFLE_MATCHES)
// = floor((90 - 10) / 3) = 26
```

That value was then written over the deliberate `15`. The bug was quiet because
it changed the stored number but **not the schedule**: with 3 teams,
`max(roundRobin=6, slots)` is 6 at both 15 and 26 minutes. Only the recorded
length moved — and with it, the honesty of the overrun. 6 × 15 = 90 minutes
against 80 playable is a ten-minute overrun; 6 × 26 = 156 is nearly double.

The shuffle now **reads the duration already scheduled** and reuses it. It falls
back to the derived value only when there is no schedule at all — a shuffle
before any generate — which makes that constant a genuine first-time default
rather than a clobber.

`DEFAULT_SHUFFLE_MATCHES = 3` was also vestigial by this point: it stopped
controlling the fixture count when truncation was removed on 2026-08-27, so its
only remaining effect was to destroy real input.

## 2. `duration` moved from the team to the fixture

`team.duration` is **gone**; `EventMatch.duration` replaces it.

It describes a **match**, not a squad. Every team in an event held the same
value, so per-team storage was redundant and could drift if one team were ever
edited alone — and a fixture list could not report its own length without
joining back through a team, which is what
`GET /events/:id/matches` needed to do.

Storing it per fixture also leaves room for a one-off longer final later,
without another schema change.

**Breaking for any client reading `team.duration`** from
`GET /events/:id/teams` — it now returns `undefined`. Read it from the fixture
instead. `listMatches` applies no projection, so it comes through automatically;
a test pins that, so a projection added later cannot silently drop it.

### Legacy fixtures have no duration

`duration` is `required` on write, and Mongoose validates on write, not on read
— so fixtures generated before today simply have no `duration` field and read as
`undefined`. Consistent with the rest of this branch, that is handled rather than
migrated: `scheduledMatchDuration` returns `null` for such an event, and a
shuffle there falls back to the derived default exactly as it would for a
brand-new event. Regenerating the teams stamps a real value.

## 3. What did NOT change: the match count

The request that prompted this also asked for a 90-minute event with 15-minute
matches to yield **5** fixtures. That was raised and deliberately not adopted.

```
slots      = floor((90 - 10) / 15) = 5
roundRobin = 3 * (3 - 1)           = 6
matches    = max(6, 5)             = 6      ← unchanged
```

Getting 5 requires `min(roundRobin, slots)`, which trims the schedule to fit and
therefore **drops a pairing** — one of the three pairs would play once instead of
twice. That is precisely the truncation removed on 2026-08-27 after it was
reported as "only 2 or 3 matches", so reinstating it silently would have undone
that fix.

The two cases also pull in opposite directions, which is worth recording:

| | 90 min | 120 min |
|---|---|---|
| `min` (cap) | 5 | 6 — leaves 20 min idle |
| `max` (today) | 6 — 10 min over | 7 |
| `slots` only | 5 | 7 |

Only `matches = slots` satisfies both "never overrun" and "never waste a slot",
at the cost of abandoning the round-robin guarantee in both directions. That
option was put forward and the decision was to **keep the overrun as is** for
now, so nothing here changed.

With `duration` now on each fixture, a client can compute the scheduled total
and warn — which is the lighter half of that problem, and is now possible
without a second call.

## 4. Files

| File | Change |
|---|---|
| `src/events/schemas/event-match.schema.ts` | `duration` added |
| `src/events/schemas/team.schema.ts` | `duration` removed |
| `src/events/events.service.ts` | fixtures stamped with `duration`; `scheduledMatchDuration`; shuffle reuses it |
| `src/events/events.service.teams.spec.ts` | duration-on-fixture, listMatches passthrough, query-aware match double |
| `docs/api/events-api.md` | §11.1 note, field table, two gotchas |
| `docs/api/README.md` | 2026-09-02 entry |

## 5. Not verified

No run against a real database. Worth confirming on the event that surfaced
this: generate with `duration: 15`, shuffle, then check
`GET /events/:id/matches` reports `"duration": 15` on every fixture rather than
26 — and that `GET /events/:id/teams` no longer carries a `duration` at all.
