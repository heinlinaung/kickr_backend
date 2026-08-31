# Change Log — 2026-08-31

**Branch:** `events-feature-spec`
**Tests:** 829 passing across 40 suites · build clean
**Verified:** unit only — no run against a real MongoDB and no live client. §7
lists what that leaves unproven, and one item there needs a real database.

Implements guest players (`+1` / `+2`), planned in
[2026-08-29 §5](./2026-08-29_payments_team_roles_and_match_fill.md).

---

## 1. The four open questions, as settled

The plan blocked on four decisions. All four came back, and each one shaped the
implementation:

| | Question | Decision | Consequence |
|---|---|---|---|
| 1 | Does an approved guest consume a `maxPlayers` slot? | **Yes**, and overspill is fine — soft limit | `joinedCount` may exceed `maxPlayers`; `isFull` flips true and closes joining |
| 2 | Payments for guests? | **No** — the sponsor pays for their guests | `EventPayment.memberId` stays a `User` ref; nothing to widen |
| 3 | Guests in standings by name? | **Moot** — standings carry no player names | No change needed anywhere |
| 4 | A guest whose sponsor leaves? | **Leaves with them** | Cascade on both exit paths |

Answer 2 is the one that saved the most work. The plan flagged widening
`memberId` to reference a roster row instead of a user as a likely migration;
"the sponsor pays" removed that entirely.

Answer 3 was worth asking even though it turned out moot — it confirmed the
standings shape (`team`, `played`, `won`, `points`, …) has no player dimension
at all, so there was nothing to extend.

## 2. The flow, end to end

The order below is the order the code runs in, because which error a member sees
depends on it.

### 2.0 Prerequisites

Two things must already be true before anyone can invite:

| | Requirement | Set by |
|---|---|---|
| 1 | Event has `isAllowExtraPlayer: true` | Organizer, at `POST /events` or `PATCH /events/:id`. **Defaults to false** (§3.3) |
| 2 | The member has **joined this event** | `POST /events/:id/join` |

### 2.1 Step 1 — the member adds a guest

```http
POST /events/{id}/guests
{}                              ← guestName optional (§3.2)
```

Five checks, **in this order**:

| | Check | Failure |
|---|---|---|
| 1 | Event exists | `404` |
| 2 | Status is `join` | `400` "Guests can only be added while registration is open" |
| 3 | `isAllowExtraPlayer` is true | `400` "This event does not allow extra players" |
| 4 | Caller has a `status: joined` row **on this event** | `403` "Join the event before adding a guest" |
| 5 | Caller has fewer than 2 non-rejected guests | `400` "You can add at most 2 guests" |

Check 3 sits before check 4 on purpose: a non-member asking about a
guests-disabled event should hear that guests are off, not that they should
join — joining would not have helped.

The row is then created `type: "guest"`, `approval: "pending"`, with `guestName`
either as sent or derived. **`joinedCount` is untouched** — a pending guest is
not playing.

### 2.2 Step 2 — waiting for a decision

| Who | Call | Sees |
|---|---|---|
| The sponsor | `GET /events/{id}/guests` | Approved guests, **plus their own** pending and rejected |
| Organizer | same route | **Every** guest — this is the approval queue |
| Anyone | `GET /events/{id}/players` | Registered players + **approved** guests only |

Pending guests are deliberately **absent from `/players`**: a team-builder must
not be offered someone who is not confirmed.

### 2.3 Step 3 — the organizer decides

```http
PATCH /events/{id}/guests/{guestId}/approval
{ "approval": "approved" }      // or "rejected"
```

Organizer only (`403`). `pending` is not accepted — a decision cannot be
un-made.

**Approved:** `joinedCount` **+1** and the guest appears in `/players`. This is
where the soft limit bites — the count may pass `maxPlayers`, which makes
`isFull` true and **closes joining for everyone else** (§5).

**Rejected:** nothing counts, and the allowance is **not** burned, so the member
can add somebody else instead.

Re-sending the same decision is a no-op, so a double-tap cannot count twice.

### 2.4 Step 4 — withdrawal (optional)

```http
DELETE /events/{id}/guests/{guestId}
```

The **sponsor or an organizer**. The row is cancelled rather than deleted, so
the record of who was brought survives. An approved guest gives their slot
back; a pending one never held one.

### 2.5 Step 5 — if the sponsor leaves

Automatic, from either exit — the member leaving, or an organizer removing them
(§6). Both responses report it:

```json
{ "data": { "message": "Left event successfully", "guestsRemoved": 2 } }
```

Surface that number: "you and your 2 guests left" reads very differently from
"you left".

### 2.6 What the flow does NOT do

- **An approved guest still cannot be placed in a team.** They are on the
  roster, but invisible to the shuffle and to `team.players` (§8). This is why
  "officially added to the team" is only half-true today.
- **A guest never gets a payment row.** The sponsor covers them (decision 2).

## 3. Schema

`EventPlayer` gains four fields, and loses a `required`:

```ts
type: 'registered' | 'guest'          // default 'registered'
userId?: ObjectId                     // was required: true
guestName?: string
addedByUserId?: ObjectId              // the sponsor
approval: 'pending'|'approved'|'rejected'   // default 'approved'
```

**`approval` is a second axis, not a widening of `status`.** They are
orthogonal: an approved guest can still leave (`status: 'cancelled'`), and a
pending guest is not on the roster yet. One field could not express "approved
but left".

Registered rows default to `approved` so a playable query needs no branch on
`type`.

### 3.1 Two traps in the schema change

**The unique index would have broken.** `{ eventId, userId }` was unique, and
guests carry no `userId` — so every guest on an event would collide with every
other on the key `(eventId, null)` and only the first could be inserted. It is
now a `partialFilterExpression: { userId: { $exists: true } }`, which says what
was always meant: uniqueness is a rule about registered users.

**No backfill migration, and that took care.** Mongoose defaults apply on
write, not on read, so every roster row written before today has **no**
`approval` field. A filter of `{ approval: 'approved' }` would have matched none
of them and emptied every existing event. The playable filter is therefore
phrased as an exclusion — `{ $nin: ['pending', 'rejected'] }` — under which
legacy rows pass untouched. It lives in one exported constant,
`PLAYABLE_APPROVAL`, so the reasoning is in one place rather than copied into
each query.

**`userId` becoming optional was the widest-reaching part**, exactly as the plan
predicted. Every read that treated it as non-null had to be audited;
`joinedPlayerIds` was the one that would actually have crashed, calling
`.toString()` on `undefined`. It is now scoped to `type: 'registered'`, which is
correct on its own terms: those ids flow into `team.players` (a `User`
reference) and into notifications, and a guest has neither an account to
reference nor a device to notify.

Minting a placeholder user per guest was rejected outright. A guest must never
be representable as an application user, or they leak into auth, search and
profiles.

### 3.2 `guestName` is derived by default

`guestName` is optional on the request. Omitted, the server names the guest
`<sponsor name> guest <n>` — "Thant guest 1", "Thant guest 2" — so the UI can
offer a bare "+ Add Guest" button with nothing to type, while an organizer still
sees something distinguishable on the approval list. An explicit value wins.

Two details:

- **The sequence counts every guest the member has ever added** to the event,
  rejected and withdrawn included. Numbering off the live allowance would reuse
  "guest 1" after a rejection and collide with the rejected row's own name.
- **The sponsor's name is populated onto the roster row already being fetched**,
  rather than injecting the `User` model into `EventsService` for one string.
  Falls back to `Guest <n>` when there is no readable name.

### 3.3 `isAllowExtraPlayer` — guests are opt-in per event

A boolean on the event, settable at `POST /events` and via `PATCH /events/:id`.
`addGuest` refuses with `400` unless it is true.

**Defaults to `false`.** A capability switch stays off until an organizer asks
for it, and that also makes the rollout migration-free: an event created before
the field existed has no value, which reads as false, so no existing event
silently starts accepting guests. Worth stating plainly because it means the
guest feature is inert until someone flips the flag — if the intent is
guests-by-default, it is a one-word change.

**Checked before the roster lookup**, so a non-member asking about a
guests-disabled event hears "this event does not allow extra players" rather
than "join first" — joining would not have helped.

Turning the flag off later does **not** remove approved guests, in the same way
closing registration does not expel players who already joined. It only stops
new ones.

### 3.4 The member-only rule was already enforced

"Only members inside that event may invite guests" needed no new code:
`addGuest` has always required a `status: 'joined'` roster row **on that
specific event**, and `403`s otherwise, with a test covering it. Group
membership is deliberately not sufficient — an organizer who never joined has
no allowance of their own.

## 4. Routes

| Method | Path | Who |
|---|---|---|
| `POST` | `/events/:id/guests` | a **joined** member |
| `GET` | `/events/:id/guests` | any user (role-aware) |
| `PATCH` | `/events/:id/guests/:guestId/approval` | organizer |
| `DELETE` | `/events/:id/guests/:guestId` | sponsor **or** organizer |

**The allowance counts non-rejected rows only.** Counting rejections would let
a member add, be rejected, and never retry — the cap would punish them for the
organizer's decision.

**`GET /guests` is role-aware**, like `/payments`: an organizer sees everything
because they decide; anyone else sees approved guests plus **their own** pending
and rejected ones. A member should be able to follow the decision on someone
they brought without reading everyone else's pending list.

**`pending` is not an accepted value on the approval route.** It is the state a
guest is created in, and allowing a move back to it would silently undo an
organizer's own decision.

## 5. Capacity — the soft limit in practice

Capacity moves **only on the approval transition**, and that is the whole
subtlety:

| Action | `joinedCount` |
|---|---|
| guest submitted | unchanged — pending guests are not playing |
| approved | **+1** |
| rejected | unchanged |
| approved → rejected | **−1** |
| approved guest withdrawn | **−1** |
| pending guest withdrawn | unchanged — never counted |
| re-approving an approved guest | unchanged — idempotent |

Per decision 1, an approval may take `joinedCount` past `maxPlayers`. The
knock-on effect is worth stating plainly because it is easy to read as a bug:
`isFull` becomes true and **joining closes for everyone else**. That is the
intended behaviour, not an accident, and a client showing "12 / 10 players"
is displaying a legitimate state.

## 6. The sponsor cascade

Both exits — a member leaving, and an organizer removing them — cancel that
member's guests. The two call one shared `cancelGuestRows`, so the count is
adjusted in exactly one place, and only approved rows decrement.

Both responses now carry `guestsRemoved`, so the client can say "you and your 2
guests left" rather than silently dropping people. That is a response-shape
addition to two existing routes, additive only.

## 7. Testing, and what is NOT proven

43 new tests in `events.service.guests.spec.ts`, 829 total. Covered: the
pending-by-default creation, the two-guest cap and its rejection exemption, the
`join`-only gate across all six states, every capacity transition in §5
including idempotency, the sponsor/organizer split on withdrawal, the role-aware
listing, and the cascade from both exits.

**Not proven — and one of these needs a real database:**

- **The `partialFilterExpression` index.** Unit tests mock Mongoose, so nothing
  here exercises the index. Inserting two guests on one event is the check, and
  it needs a live MongoDB. **If that index is wrong, the second guest on any
  event fails to insert** — the highest-consequence unverified item in this
  change.
- **The legacy-row reasoning.** `PLAYABLE_APPROVAL` is argued from how Mongoose
  defaults work, not demonstrated against rows written before today. Worth one
  query against a real event that predates this deploy.
- No live client has consumed the new `type`/`guestName` shape.

## 8. Still not built

| | Why |
|---|---|
| **Guests in teams** | `team.players` references `User`, so a guest cannot go in it. Needs a `team.guests` field referencing roster rows — the same annotate-don't-reshape trade as `playerRoles`. Approved guests appear on the roster but not in the shuffle. |
| **Guests in standings** | Nothing to do — see decision 3. |
| **Notifying a guest** | Impossible: no account, no device. The sponsor is the contact. |

The teams gap is the real remaining work, and it is the reason "officially added
to the team" is only half-true today: an approved guest is officially on the
**roster**, but cannot yet be placed in a team.

## 9. Files

| File | Change |
|---|---|
| `src/events/schemas/event-player.schema.ts` | guest fields, optional `userId`, partial unique index, `PLAYABLE_APPROVAL` |
| `src/events/events.service.ts` | four guest methods, `cancelGuestRows`, `cascadeGuestsOfSponsor`, cascade wired into `leave`/`removePlayer`, `listPlayers` + `joinedPlayerIds` scoped |
| `src/events/events.controller.ts` | four routes + Swagger |
| `src/events/dto/add-guest.dto.ts`, `set-guest-approval.dto.ts` | new |
| `src/events/events.service.guests.spec.ts` | new, 34 tests |
| `docs/api/events-api.md` | §13, endpoint table, §12 payments note, five gotchas |
| `docs/api/README.md` | 2026-08-31 entry |
