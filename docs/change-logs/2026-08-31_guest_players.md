# Change Log — 2026-08-31

**Branch:** `events-feature-spec`
**Tests:** 820 passing across 40 suites · build clean
**Verified:** unit only — no run against a real MongoDB and no live client. §6
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

## 2. Schema

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

### 2.1 Two traps in the schema change

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

## 3. Routes

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

## 4. Capacity — the soft limit in practice

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

## 5. The sponsor cascade

Both exits — a member leaving, and an organizer removing them — cancel that
member's guests. The two call one shared `cancelGuestRows`, so the count is
adjusted in exactly one place, and only approved rows decrement.

Both responses now carry `guestsRemoved`, so the client can say "you and your 2
guests left" rather than silently dropping people. That is a response-shape
addition to two existing routes, additive only.

## 6. Testing, and what is NOT proven

34 new tests in `events.service.guests.spec.ts`, 820 total. Covered: the
pending-by-default creation, the two-guest cap and its rejection exemption, the
`join`-only gate across all six states, every capacity transition in §4
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

## 7. Still not built

| | Why |
|---|---|
| **Guests in teams** | `team.players` references `User`, so a guest cannot go in it. Needs a `team.guests` field referencing roster rows — the same annotate-don't-reshape trade as `playerRoles`. Approved guests appear on the roster but not in the shuffle. |
| **Guests in standings** | Nothing to do — see decision 3. |
| **Notifying a guest** | Impossible: no account, no device. The sponsor is the contact. |

The teams gap is the real remaining work, and it is the reason "officially added
to the team" is only half-true today: an approved guest is officially on the
**roster**, but cannot yet be placed in a team.

## 8. Files

| File | Change |
|---|---|
| `src/events/schemas/event-player.schema.ts` | guest fields, optional `userId`, partial unique index, `PLAYABLE_APPROVAL` |
| `src/events/events.service.ts` | four guest methods, `cancelGuestRows`, `cascadeGuestsOfSponsor`, cascade wired into `leave`/`removePlayer`, `listPlayers` + `joinedPlayerIds` scoped |
| `src/events/events.controller.ts` | four routes + Swagger |
| `src/events/dto/add-guest.dto.ts`, `set-guest-approval.dto.ts` | new |
| `src/events/events.service.guests.spec.ts` | new, 34 tests |
| `docs/api/events-api.md` | §13, endpoint table, §12 payments note, five gotchas |
| `docs/api/README.md` | 2026-08-31 entry |
