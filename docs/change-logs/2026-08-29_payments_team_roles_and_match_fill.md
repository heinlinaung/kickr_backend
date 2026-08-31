# Change Log — 2026-08-29

**Branch:** `events-feature-spec`
**Tests:** 786 passing across 39 suites · build clean
**Verified:** unit only — no run against a real MongoDB and no live client.

Five changes shipped, one feature planned but **not** built (§5).

| | Change | Kind |
|---|---|---|
| §1 | `GET /events/:id/matches` now fills the event duration | **fix** |
| §2 | Member payments — new schema + two routes | new |
| §3 | Team member roles — captain, new route | new |
| §4 | `additionalPrice` / `takeAdditionalPrice` on the event | new fields |
| §4b | `GET /events` includes the caller's own joined events | **behaviour change** |
| §5 | Plus members (`+1`/`+2`) | **plan only** |

**No database migration.** Every new field has a default, and the two new
collections start empty.

---

## 1. Fix — the match schedule now fills the booked slot

**Reported:** a 2-hour event with 10-minute matches generated 6 fixtures
(60 minutes of play), leaving an hour of the pitch unscheduled. Expected 11.

Reproduced exactly: `matchCountFor(120, 10)` is 11, while a 3-team round-robin
is 6, and generation was emitting the round-robin.

This field has now moved twice, so it is worth stating the whole arc:

| | Behaviour | Failure |
|---|---|---|
| originally | `roundRobin.slice(0, slots)` | **truncated** — 3 teams in a short event lost half their pairings, unrecoverably |
| 2026-08-27 | `roundRobin` | **underfilled** — 6 fixtures in a slot with room for 11 |
| now | `max(roundRobin, slots)` | overruns a short event, by choice |

```
slots      = floor((event.duration - 10) / duration)
roundRobin = teamsCount * (teamsCount - 1)
matches    = max(roundRobin, slots)
```

Extra slots **repeat the round-robin from the start** rather than inventing
pairings, so the rotation stays balanced, and `matchNumber` is renumbered
contiguously across the whole schedule — slot 7 is match 7, not match 1 again.

**The remaining trade-off, chosen deliberately.** The round-robin is a *floor*,
so a short event still overruns: 3 teams in a 40-minute event get all 6
fixtures where only 3 fit. Trimming to 3 would resurrect the original bug, and
losing pairings is worse than running long — an organizer can shorten `duration`
or simply not play the trailing matches. The single-match sanity check survives,
so a `duration` too long for the event is still a `400`.

## 2. Member payments

New collection `EventPayment`: `{ eventId, memberId, isPaid, paidAt, recordedBy }`,
unique on `(eventId, memberId)`.

Its own collection rather than a field on `EventPlayer`, because a payment
outlives the roster row — someone who pays and then leaves still paid — and the
roster row is rewritten by join/leave.

**No amount is stored.** The price lives on the event (§4), so copying it per
member would drift the moment an organizer edited it. The row answers exactly
one question: has this member paid? The unique index is what makes that answer
unambiguous — the endpoint upserts, and without it a concurrent double-tap
would create two rows.

**`GET /events/:id/payments` is role-aware rather than two routes.** An
organizer gets every member; anyone else gets only their own row, because a
member has no business reading who else has paid. `memberId` is populated with
display fields only — never the email, matching the fix applied to
`/groups/:id/members` on 2026-08-26.

**A member with no row is absent, not synthesised as unpaid.** "Not recorded"
and "recorded as unpaid" are different states and the client should be able to
tell them apart; the roster comes from `GET /events/:id/players`.

`paidAt` tracks the transition, not the write: stamped when `isPaid` becomes
true, **cleared when a payment is reversed**, so it can never read as a payment
date for someone currently unpaid. `recordedBy` captures which organizer marked
it — payments are recorded here, not taken. No money moves through this API.

**Gap, stated rather than discovered later:** guest players (§5) have no user
id, so they cannot hold a payment row. Building `+1`/`+2` will require either
widening `memberId` or adding a guest reference.

## 3. Team member roles

`PATCH /events/:id/teams/:teamId/members/:userId/role`, enum `player | captain`.

Callable by owner/admin **or a group `captain`** — a new `TEAM_ROLE_MANAGER_ROLES`
list, since naming a captain is squad management, which that role exists for. It
grants nothing else: a captain still cannot edit the event, move its status, or
take payments. This mirrors how `referee` was added for score entry alone.

### The `team.players` decision

The brief left this open. `players` is **unchanged** — still a flat id array —
and a parallel `playerRoles: [{ userId, role }]` annotates it.

Reshaping `players` into `[{ userId, role }]` is the tidier model: one source of
truth, no chance of divergence. It was rejected because `players` is populated
straight into user objects by `GET /events/:id/teams`, so reshaping it changes
the response for **every existing client**, and the assign path, notifications
and the shuffle all read it as ids. That is a broad breaking change to buy a
schema nicety, on top of a branch that already carries several.

The cost of annotating is that two fields must be kept consistent. That is
handled in one place: `assignTeamPlayers` prunes roles for players who are no
longer in the squad, so a dropped captain cannot keep an invisible role that
resurfaces if they are reassigned. There is a test for it.

**`player` is stored as absence.** Setting it removes the entry rather than
writing `role: 'player'`, so the default has exactly one representation and a
player cannot be both absent and explicitly default at once.

The target must already be in `team.players` — a role on someone outside the
squad would be invisible on every read.

## 4. `additionalPrice` and `takeAdditionalPrice`

Two fields on the event, defaulting to `0` and `false`.

Kept separate from `price` so the base fee and the surcharge stay individually
reportable, and separate from each other so an organizer can configure a
surcharge and switch it off between events without retyping the amount. The
total is `price + (takeAdditionalPrice ? additionalPrice : 0)`, computed by the
client.

Both are settable at `POST /events` and via `PATCH /events/:id` — note the
latter needed the field names adding to the service's `EDITABLE` allowlist, or
a PATCH would have silently dropped them.

## 4b. `GET /events` now includes the caller's joined events

The filter was `{ isPublic: true }` and nothing else, so a private group's
event was invisible here **even to someone on its roster**. It is now a
disjunction: public, OR on the caller's roster — being on the roster is the
permission, exactly as it is for `GET /events/joined`.

```ts
{ $or: [{ isPublic: true }, { _id: { $in: joinedEventIds } }] }
```

The `$or` sits at the top level so every other narrowing — `?region=`,
`?status=`, `?from=`/`?to=`, `?near=` — stays ANDed against it. A joined event
must not bypass an explicit filter.

**Every row now carries `joinedByMe`.** Without it the mixed list is ambiguous:
a client could not tell a private event it may open from a public one it has
not joined. This matches `GET /events/:id` and `GET /events/joined`, which both
already carried the flag. Strictly an addition beyond the request, but the
feature is hard to consume without it.

Two incidental findings:

- **`userId` was a dead parameter.** `list()` took it and never used it — it
  appeared exactly once, in the signature. This change is what finally gives it
  a purpose.
- **`joinedEventIds` is now shared** with `listJoined`, which had the same query
  inline, and it guards against a malformed user id rather than letting the
  driver raise a BSONError as a 500. Several older specs called `list('u1', …)`
  with a placeholder id, which only surfaced once the roster lookup existed.

**Still no default date or status filter on this route** — unlike its two
siblings, it returns past and `done` events unless narrowed. That inconsistency
predates this change and was left alone, but it is now documented in
events-api §5.1 and the gotchas, because a discovery feed built on an
unfiltered call shows archived events.

## 5. Plus members (`+1` / `+2`) — PLAN ONLY, nothing built

> **Superseded 2026-08-31 — this is now built.** All four open questions in §5.4
> were answered and the feature shipped; see
> [2026-08-31_guest_players.md](./2026-08-31_guest_players.md) for what was
> actually implemented and how the plan below changed on contact. The plan is
> left unedited as the record of what was proposed.

A player brings a friend who has no account. The guest must be approved by the
event owner/admin before they count.

### 5.1 Schema

`EventPlayer` today is `{ eventId, userId, joinedAt, team, position, status, checkInTime }`
with `status: 'joined' | 'cancelled'`. Guests need:

```ts
type: 'registered' | 'guest'   // default 'registered'
userId?: ObjectId              // becomes OPTIONAL — a guest has no account
guestName?: string
addedByUserId?: ObjectId       // the member who brought them
approval: 'pending' | 'approved' | 'rejected'   // guests only
```

**`approval` must be a second field, not a widening of `status`.** They are
orthogonal axes: an approved guest can still leave (`status: 'cancelled'`), and
a pending guest is not on the roster yet. Overloading one field would make
"approved but left" unrepresentable.

Making `userId` optional is the change with the widest blast radius — it is
currently `required: true` and is read as a non-null id by the roster listing,
the shuffle, team assignment, standings and notifications. Every one of those
paths needs a decision about guests before this ships.

### 5.2 Endpoints

| Method | Path | Who |
|---|---|---|
| `POST` | `/events/:id/guests` | any joined member — `{ guestName }` |
| `DELETE` | `/events/:id/guests/:guestId` | the member who added them, or an organizer |
| `PATCH` | `/events/:id/guests/:guestId/approval` | organizer — `{ approval: 'approved' \\| 'rejected' }` |
| `GET` | `/events/:id/guests` | any joined member |

### 5.3 The rules that need enforcing

- **Max 2 guests per member**, counted over non-rejected rows only, or a member
  could add, get rejected, and retry indefinitely.
- **Only approved guests count as playable.** `joinedCount` and the `isFull`
  derivation must include approved guests and exclude pending ones, or capacity
  silently overshoots.
- **Only approved guests enter team assignment**, the shuffle, matches and
  standings.
- **Guests are added during `join` only**, matching every other roster change.

### 5.4 Open questions to settle before building

1. **Does an approved guest consume a `maxPlayers` slot?** Almost certainly yes,
   but that makes `joinedCount` a derived figure over two shapes of row, and it
   is currently a stored counter incremented by join/leave. That counter is the
   single most likely thing to drift.
2. **Payments (§2) key on a user id.** A guest has none, so either `memberId`
   widens to reference an `EventPlayer` row instead of a `User`, or guests are
   excluded from payments — which contradicts the spec's guest payment rows.
3. **Do guests appear in standings by name?** They have no profile to link to.
4. **What happens to an approved guest's team slot if their sponsor leaves?**

Recommend settling 1 and 2 before any code: both change schemas that already
exist, and getting them wrong means a second migration.

## 6. Files

| File | Change |
|---|---|
| `src/events/events.fixtures.ts` | `generateFixturesFilling` |
| `src/events/schemas/event-payment.schema.ts` | new |
| `src/events/schemas/team.schema.ts` | `playerRoles`, role enum |
| `src/events/schemas/event.schema.ts` | `additionalPrice`, `takeAdditionalPrice` |
| `src/events/events.service.ts` | fill wiring, payments, team roles, role pruning, `EDITABLE`, `list()` visibility + `joinedEventIds` |
| `src/events/events.controller.ts` | three routes + Swagger |
| `src/events/dto/` | `set-payment`, `set-team-member-role`, create/update event fields |
| `src/events/events.module.ts`, `events.test-providers.ts` | payment model wiring |
| `docs/api/events-api.md` | §11.1 match count, §11.2c roles, §12 payments, gotchas |
| `docs/api/README.md` | 2026-08-29 entry |
