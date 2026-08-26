# KickR Events --- Event Lifecycle & Guest Players

## Overview

KickR events follow six statuses:

`join → preparation → ready_to_play → playing → after_match → done`

The UI is status-aware and role-aware. Members and Admin/Owner users
should see different actions for each stage.

------------------------------------------------------------------------

# Implementation Status — verified 2026-08-26

This document describes the **target** state. Below is what the backend
actually does today, verified against the code on branch
`events-feature-spec`.

The lifecycle section is accurate and shipped. **Payments, Ratings and
Followers do not exist at all and are explicitly out of scope** (see
Skipped). One claim in this doc reverses a deliberate code decision, and
the verification turned up one live privacy leak.

> Guest players (`+1` / `+2`) were **excluded** from this verification by
> request. Every guest-player section below is unverified.

## ⏭️ Skipped — not in scope, do not implement from this doc

These are specified above but deliberately **not** being built now. They
have **zero** supporting code today — no schema, no endpoint, no service.

- [x] ~~**Payments / "Manage Payments"**~~ — **SKIPPED.** No code at all.
      `Event.price` exists as a fee amount, but there is no per-player
      paid/unpaid record anywhere. Affects §5 (After Match) and the
      payment rows in the feature matrix.
- [x] ~~**Ratings**~~ — **SKIPPED.** No code at all. Only a placeholder
      `avgRating: 0 // TODO(§4.10)` in the profile statistics. Affects §6
      (Done), "Submit Rating", and the "★ 4.7 / 24 ratings" summary.
- [x] ~~**Follow User**~~ — **SKIPPED.** No code at all, and no
      `followers_count` anywhere. Affects the Follow User section and the
      profile statistics.

Do not design screens against the three above.

## ✅ Fix in this document — DONE 2026-08-26

All six items below have been corrected in place. The Event Lifecycle,
Roles, Role-Based Feature Matrix and Profile API sections now match the
code.

- [x] **The `LEGAL` transitions block lists `['preparation', 'playing']`,
      which now returns `409`.** It was removed on 2026-08-24 so kick-off
      has to pass through `ready_to_play`. A client following this block
      gets a hard error.
- [x] **The `LEGAL` block omits `ready_to_play` entirely**, contradicting
      this document's own opening line, which lists six statuses.
- [x] **The `LEGAL` block is missing the reverse edge
      `['ready_to_play', 'preparation']`** — used to send a
      reviewed-but-wrong team set back to be re-shuffled.
- [x] **Remove the resolved note** beginning *"If it is persisted as its
      own `EventStatus` value…"*. It is persisted as its own value; the
      note shipped.
- [x] **Add the Referee role.** Added as its own section, plus a Referee
      column in the feature matrix. Referee is implemented — a group referee
      may enter match scores (`SCORER_ROLES = ['owner','admin','referee']`).
      This document has only Member and Admin/Owner, so the feature-matrix
      rows "Add result" and "Edit result" are wrong. The 2026-08-20 doc had
      a Referee flow; this one dropped it.
- [x] **Profile API field names match nothing in the code.** Documented
      side by side with what the endpoint actually returns, plus the two
      decisions needed before implementing (naming convention, and
      rename-vs-add for `matchesPlayed`). This doc asks
      for `group_count`, `joined_event_count`, `points`,
      `followers_count`; the code returns `matchesPlayed`, `wins`,
      `mvpCount`, `avgRating` — the last three hardcoded `0`. Only
      `joined_event_count` has an equivalent (`matchesPlayed`). Note the
      snake_case here is also inconsistent with the rest of the API, which
      is camelCase.

The correct transition table, verified programmatically (6 states, 36
ordered pairs, 7 legal edges):

``` ts
const LEGAL: ReadonlyArray<[EventStatus, EventStatus]> = [
  ['join', 'preparation'],
  ['preparation', 'ready_to_play'],
  ['preparation', 'join'],          // reopen registration
  ['ready_to_play', 'playing'],
  ['ready_to_play', 'preparation'], // re-shuffle a wrong team set
  ['playing', 'after_match'],
  ['after_match', 'done'],
];
```

## ✅ Decided and implemented — 2026-08-26

- [x] **"A private group is still searchable."** **Decided: yes** — this
      document is correct and the old behaviour was inverted. Group privacy
      now protects **contents**, not existence. Implemented:
      - `GET /groups/search` includes private groups, and returns
        `isPrivate` so the client can show a lock and a "request to join"
        action instead of navigating into a `403`.
      - Search now returns a **reduced card** and no longer leaks
        `inviteCode` — it previously returned the whole group document for
        every hit, which with private groups included would let anyone
        mass-request to join.
      - Empty `q` returns `[]`. An empty regex matched every group; that
        was survivable for public-only results and is an enumeration tool
        once private groups are in scope.

## ✅ Fix in the code — DONE 2026-08-26

- [x] **`GET /groups/:id/members` returned member email addresses.**
      **Fixed:** the populate is now
      `'name username displayName profileImage'` — no email. Two
      regression tests pin it. `InvitationsService.listPending` still
      populates email and was left alone deliberately: it is
      `assertOwnerOrAdmin`-gated, and an owner vetting a join request has
      a reason to identify the requester. **The missing access gate is now
      closed too** — a private group's member list requires approved
      membership (see the private-group decision below). Original finding: Any authenticated user can list any group's
      members, private or not, and the query populates
      `'name email profileImage'`. This is a live privacy leak and a small
      fix. Notable because `/users/search` goes out of its way never to
      return an email.

## Remaining — not built

- [x] **Private group hides its event listing from non-members.**
      **Done.** `EventsService.listByGroup` now reads `isPrivate` and
      throws `403` for a non-approved caller, instead of quietly showing
      the group's public events. `403` rather than `[]` so the client can
      render a join prompt rather than a misleading empty state.
- [x] **Private group hides its member listing from non-members.**
      **Done.** `listMembers` is gated by the same approved-membership
      check, which also closes the access-gate half of the email leak.
- [x] **Admin "Remove from event"** — **DONE 2026-08-26.**
      `DELETE /events/:id/players/:userId`, organizer-gated and `join`-only.
      Cancels the roster row rather than deleting it (so it reactivates on
      rejoin) and decrements `joinedCount`. Past `join` it `400`s: teams and
      fixtures reference the roster, so the organizer reopens registration
      (`preparation → join`) first. Self-leave stays a separate route.

## 🔵 Know this, but no action needed

- [ ] **`GET /events/:id/teams` returns *all* teams to any authenticated
      user.** The Member "Your Team" view is client-side only — it is not a
      privacy boundary, so do not rely on it as one.
- [ ] **Teams lock one stage earlier than this doc's prose implies.**
      "Teams should be effectively locked once pressed" suggests the lock
      lands on entering `playing`; the code freezes the roster throughout
      `ready_to_play` (`canShuffle` is false there). This matches this
      doc's own Ready-to-Play mockup, which shows no Shuffle/Edit buttons.
      No change needed.

## ✅ Verified correct — matches the code

- [x] Six statuses and their order:
      `join → preparation → ready_to_play → playing → after_match → done`
- [x] `preparation → join` reopens registration
- [x] Organizer-gating on status changes, team generate, team edit, match
      create, and result entry
- [x] `[ Shuffle Teams ]` → `POST /events/:id/shuffle` exists, guarded, and
      registered (it lives in its own `src/shuffle/` module, not in
      `events.controller.ts`)
- [x] `[ Edit Teams ]` → `PATCH /events/:id/teams/:teamId`, organizer-gated
- [x] `[ + Add Match ]` → `POST /events/:id/matches`, organizer-gated
- [x] Match list and score entry
- [x] Standings → `GET /events/:id/standings`
- [x] Members cannot start the event, edit teams, or edit results

## Suggested order

1. Fix the `LEGAL` block in this document — it will send a client author
   straight into a `409`.
2. Answer the private-group search question.
3. Patch the members-endpoint email leak.

------------------------------------------------------------------------

## Roles

### Member

A registered KickR user who joins an event.

Members can:
- Join or leave an event.
- View members.
- View their assigned team after teams are published.
- View matches and results.
- View standings.
- Rate the event after completion.

Members cannot:
- Modify other members.
- Create or edit teams.
- Start the event.
- Add or edit match results.
- Modify payment records.

### Admin / Owner

Admins/Owners can:
- Manage members.
- Approve or reject guest or plus players.
- Create, shuffle, and manually edit teams.
- Start the event.
- Add/edit match results.
- Manage payment status for each players. *(⏭️ payments SKIPPED)*
- View the final event summary and ratings. *(⏭️ ratings SKIPPED)*

### Referee

A group member holding the `referee` role. **Implemented** — this role
already exists in the backend and was missing from earlier drafts of this
document.

A referee is not an organizer. Officiating is the *only* thing the role
grants, and it grants it in exactly one place:

Referees can:
- Enter and edit match results (`PATCH /events/:id/matches/:matchNumber`).
- Everything a Member can do.

Referees cannot:
- Create, shuffle or edit teams.
- Start the event or change its status.
- Manage members.
- Anything else an Admin/Owner can do.

In the code this is `SCORER_ROLES = ['owner', 'admin', 'referee']`, used by
the score-entry guard and nowhere else — deliberately narrower than the
organizer check, which covers a dozen other operations a referee has no
business performing.

The UI should therefore show a referee the **Member** view of every stage
except Playing, where they get the Admin/Owner result-editing controls.

------------------------------------------------------------------------

# Event Lifecycle

``` text
JOIN
  ↓
PREPARATION
  ↓
READY TO PLAY
  ↓
PLAYING
  ↓
AFTER MATCH
  ↓
DONE
```

Legal transitions:

``` ts
const LEGAL: ReadonlyArray<[EventStatus, EventStatus]> = [
  ['join', 'preparation'],
  ['preparation', 'ready_to_play'],
  ['preparation', 'join'],          // reopen registration
  ['ready_to_play', 'playing'],
  ['ready_to_play', 'preparation'], // re-shuffle a wrong team set
  ['playing', 'after_match'],
  ['after_match', 'done'],
];
```

Seven edges over six states. Verified against
`src/events/events.lifecycle.ts` on 2026-08-26: all 36 ordered pairs are
asserted in `events.lifecycle.spec.ts`, so this table cannot drift from the
implementation without failing the suite.

**Two reverse edges, and no others:**

`['preparation', 'join']` reopens registration — an Admin/Owner can go back
from Preparation if the roster needs to change before teams are finalized.

`['ready_to_play', 'preparation']` sends a reviewed-but-wrong team set back
to be re-shuffled. This is safe in a way no later reverse edge would be: no
score can have been entered yet, so going back cannot discard one. There is
deliberately **no** `['ready_to_play', 'join']` — reopening registration
from Ready to Play is two deliberate steps, not one.

> ⚠️ **`['preparation', 'playing']` is NOT legal and returns `409`.**
> It was removed on 2026-08-24. Kick-off must pass through
> `ready_to_play`, so any client with a "start match" button on the
> team-assignment screen needs a release. A stage that can be bypassed is
> decoration — the roster freeze in Ready to Play only means something if
> kick-off has to pass through the state that enforces it.

`ready_to_play` **is** persisted as its own `EventStatus` value, not a UI
sub-state. It gates something the neighbouring states do not: teams are
built and shuffled in `preparation`, and in `ready_to_play` they are final
and view-only (`canShuffle` is false there), while scoring is still closed.

------------------------------------------------------------------------

# 1. Join

The Join stage focuses on registration and participants. Both roles
see the member list here — the difference is what each role can *do*
with it.

### Member

Show: - Participant count. - Member list. - Participation status. -
Guest player controls.

Example:

``` text
Members

26 Players

[avatars...] +23

Your participation
✓ You're going

Additional Players
[ + Add Guest ]

You can add up to 2 guest players
```

Guest players must be clearly identified:

``` text
Thant
Registered

John
Guest • Pending approval
```

### Admin / Owner

Same member list, plus a settings icon to modify members.

``` text
Members                         ⚙

26 Registered
2 Guests

Search members...

Thant
Member                         ⋮

John
Member                         ⋮
```

Per-member menu: - View profile - Make organizer - Remove from event

Use the global settings icon (⚙) for event/member-level settings —
this is the entry point for admin member management, not a separate
screen.

------------------------------------------------------------------------

# 2. Preparation

Preparation is for team creation and player assignment.

### Member

Before teams are published, show a waiting message:

``` text
Preparation

          ⏳

Organizer is preparing the teams.

You'll see your team here once
the teams are ready.
```

Members should not see team-management controls at this stage.

### Admin / Owner

Show the team-creation list and let the admin build teams by shuffle
or manual assignment:

``` text
Preparation

26 Players
3 / 4 Teams

Team assignment

27 players → 4 teams

[ Shuffle Teams ]    [ Edit Teams ]

Teams

⚫ Black Team       7
🔵 Blue Team        7
🔴 Red Team         7
🟡 Yellow Team      7
```

Recommended UX: - `Shuffle Teams` = primary automatic action. -
`Edit Teams` = manual adjustment.

The explicit "Ready to Play" confirmation now lives in the next
stage, not here — Preparation ends once the admin is satisfied with
the team split.

------------------------------------------------------------------------

# 3. Ready to Play

Once teams are set, this stage confirms everyone is ready before the
event starts.

### Member

Show each member their own assigned team:

``` text
Your Team

🔵 BLUE TEAM

6 Players

Thant
John
Mike
Alex
Chris
Sam

✓ Team ready

Waiting for organizer to start...
```

### Admin / Owner

Show the full team list and the explicit confirmation action:

``` text
Ready to Play

28 Players
4 Teams

⚫ Black Team       7
🔵 Blue Team        7
🔴 Red Team         7
🟡 Yellow Team      7

[ ✓ Play ]
```

`Ready to Play` is the single explicit confirmation that moves the
event into `playing`. Treat it as a destructive/committing action —
teams should be effectively locked once pressed.

------------------------------------------------------------------------

# 4. Playing

Playing is match-focused. Both roles see matches; only Admin/Owner can
add results.

### Member

Members can view: - Their team. - Match schedule. - Match status. -
Results.

They cannot edit results.

``` text
Matches

Match 1
🔵 Blue Team       2
⚫ Black Team       1
✓ Finished

Match 2
🔵 Blue Team       —
🔴 Red Team        —
Upcoming
```

### Admin / Owner

Admins see the same match list, plus the ability to add and edit
results.

``` text
Match 1

🔵 Blue Team       2
⚫ Black Team       1

✓ Finished                 Edit

[ + Add Match ]
```

Use a dedicated result form:

``` text
Match Result

Blue Team       [ 2 ]
Black Team      [ 1 ]

[ Cancel ]       [ Save Result ]
```

------------------------------------------------------------------------

# 5. After Match

> ⏭️ **Payments are SKIPPED** — out of scope, zero code today. The
> standings half of this stage IS built
> (`GET /events/:id/standings`); every payment element below —
> "Manage Payments", the fee display, paid/unpaid marking — is not, and
> should not be built from this doc. See Implementation Status.

This stage focuses on standings and payments. Both roles see
standings; only Admin/Owner manages payment status.

### Member

``` text
Final Standings

🥇 Blue Team       9 pts
🥈 Black Team      7 pts
🥉 Red Team        5 pts
4️⃣ Yellow Team    2 pts
```

Payment:

``` text
Payment

Event fee
$20.00

✓ Paid
```

Unpaid:

``` text
$20.00
⚠ Payment pending
```

### Admin / Owner

Admins see the same standings, plus per-member payment management:

``` text
Payments

Thant
$20     ✓ Paid

John
$20     ⚠ Unpaid

Mike
$20     ✓ Paid
```

Actions: - Mark as paid - Mark as unpaid

Use **Manage Payments** as the feature name.

------------------------------------------------------------------------

# 6. Done

> ⏭️ **Ratings are SKIPPED** — out of scope, zero code today. That covers
> "Submit Rating", the star input, "Player Feedback ★ 4.7 / 5", and
> "View All Reviews". The `done` status itself exists and is terminal;
> only the rating content is unbuilt. See Implementation Status.

### Member

``` text
Event Complete 🎉

Aura Bangkok (Sat)

You finished with
🔵 Blue Team

Final position
🥇 1st Place

How was the event?

☆ ☆ ☆ ☆ ☆

[ Submit Rating ]
```

### Admin / Owner

``` text
Event Complete 🎉

Aura Bangkok (Sat)

26 Players
4 Teams
12 Matches

Final Standings

🥇 Blue Team
🥈 Black Team
🥉 Red Team
4️⃣ Yellow Team

Player Feedback
★★★★☆ 4.7 / 5
24 ratings

[ View All Reviews ]
```

------------------------------------------------------------------------

# Additional Players (+1 / +2)

See also: [Additional Players change log](https://github.com/tharhtet/kickr_backend/blob/main/docs/change-logs/2026-08-20_events_and_user_changes.md#additional-players-1--2)

After joining an event, a registered member can add **one or two guest
players** who do not have a KickR application account.

These players are supported as **Guest Players**.

## Requirements

The system should: - Allow a member to add `+1` or `+2` players. -
Allow a maximum of two guests per registered member. - Identify guest
players separately from registered users. - Allow Admin/Owner to
review and approve guest players. - Allow Admin/Owner to reject guest
players. - Include approved guest players when creating teams. -
Include guest players in matches, results, and standings where
applicable. - Include approved guests in payment management where
applicable.

Guest players do not need a KickR account.

## Guest Status

``` text
pending
approved
rejected
```

### Pending

-   Visible to the member who added them.
-   Visible to Admin/Owner.
-   Not included in playable counts.
-   Cannot be assigned to teams.
-   Cannot participate in matches.

### Approved

-   Counts as a playable participant.
-   Can be assigned to a team.
-   Can participate in matches.
-   Can appear in results and standings.
-   Can appear in payment records.

### Rejected

-   Cannot participate.
-   Cannot be assigned to a team.
-   Must not be included in playable counts.

------------------------------------------------------------------------

# Guest Player UX

## Member

``` text
Additional Players

[ + Add Guest ]

You can add up to 2 guest players
```

After adding one:

``` text
Additional Players

John
Guest • Pending approval

[ + Add Guest ]
```

## Admin / Owner

``` text
Guest Players

┌──────────────────────────────┐
│ John                         │
│ Added by Thant               │
│ Guest                        │
│                              │
│ [ Reject ]     [ Approve ]   │
└──────────────────────────────┘
```

After approval:

``` text
✓ Approved Guest

John
Guest • Added by Thant
```

------------------------------------------------------------------------

# Guest Players in Teams

Only approved guests enter team assignment.

``` text
Players

26 Registered
+2 Approved Guests

28 Players

[ Shuffle Teams ]    [ Edit Teams ]
```

Guest badge:

``` text
🔵 Blue Team

Thant
John
Chris • Guest
Alex
Sam
```

------------------------------------------------------------------------

# Guest Players in Matches, Results & Standings

Approved guests behave like event participants:

``` text
Match 1

🔵 Blue Team       2
⚫ Black Team       1

Players
Thant
John
Chris • Guest
```

They may also appear in player-level results and standings where
applicable.

------------------------------------------------------------------------

# Guest Players & Payments

Approved guests can be included in payment management:

``` text
Payments

Thant              ✓ Paid
John               ⚠ Unpaid
Chris • Guest      ✓ Paid
```

Actions: - Mark as paid - Mark as unpaid

------------------------------------------------------------------------

# Data Model

Registered users and guests must remain distinguishable.

``` ts
type EventPlayerType = 'registered' | 'guest';

interface EventPlayer {
  id: string;
  eventId: string;

  type: EventPlayerType;

  // Registered player
  userId?: string;

  // Guest player
  guestName?: string;
  addedByUserId?: string;

  status: 'pending' | 'approved' | 'rejected';

  teamId?: string;
}
```

Registered player:

``` text
type = registered
userId = <KickR user id>
```

Guest player:

``` text
type = guest
guestName = "John"
addedByUserId = <registered member id>
status = pending | approved | rejected
```

Guest players must never be represented as fake application users.

------------------------------------------------------------------------

# Player Count Rules

There are four useful categories:

-   **Registered Members** --- KickR users who joined.
-   **Pending Guests** --- awaiting approval.
-   **Approved Guests** --- approved to participate.
-   **Playable Players** --- registered members + approved guests.

Example:

``` text
26 Registered
2 Pending Guests
1 Approved Guest
1 Rejected Guest

Playable Players = 27
```

Pending and rejected guests must not affect team assignment or playable
player counts.

------------------------------------------------------------------------

# Role-Based Feature Matrix

| Feature | Member | Referee | Admin / Owner | Built? |
|---|---|---|---|---|
| View members | ✓ | ✓ | ✓ | ✓ |
| Join / leave | ✓ | ✓ | ✓ | ✓ |
| Add +1 / +2 guest | ✓ | ✓ | ✓ | *not verified* |
| Approve / reject guest | — | — | ✓ | *not verified* |
| View guest status | ✓ | ✓ | ✓ | *not verified* |
| Create teams | — | — | ✓ | ✓ |
| Shuffle teams | — | — | ✓ | ✓ |
| Edit teams | — | — | ✓ | ✓ |
| Ready to Play | ✓\* | ✓\* | ✓ | ✓ |
| View matches | ✓ | ✓ | ✓ | ✓ |
| Create match | — | — | ✓ | ✓ |
| **Add result** | — | **✓** | ✓ | ✓ |
| **Edit result** | — | **✓** | ✓ | ✓ |
| View standings | ✓ | ✓ | ✓ | ✓ |
| Manage payments | — | — | ✓ | ⏭️ **SKIPPED** |
| View payment status | ✓ | ✓ | ✓ | ⏭️ **SKIPPED** |
| Rate event | ✓ | ✓ | ✓ | ⏭️ **SKIPPED** |
| View event summary | Limited | Limited | ✓ | ❌ no "limited" variant |
| Make organizer | — | — | ✓ | ❌ not built |
| Remove from event | — | — | ✓ | ✅ `join` only |

`* Member and Referee can only *view* the Ready to Play state (own team +
waiting message); only Admin/Owner can trigger the transition.`

**Changes from the earlier draft of this table:**

- **Referee column added.** It is implemented, and "Add result" / "Edit
  result" previously read as Admin/Owner-only, which was wrong.
- **`Built?` column added**, so a row cannot be read as available when
  nothing backs it.
- **`Make organizer` and `Remove from event` added** — described in §1
  (Join) as per-member menu actions but absent from this table.
  `Remove from event` is now **built**
  (`DELETE /events/:id/players/:userId`, organizer-gated, `join` only).
  `Make organizer` is still absent from the code and needs a per-event role
  model before it can exist.
- **`View event summary`**: there is no reduced-payload variant.
  `GET /events/:id` returns the same body to everyone, so "Limited" is a
  client-side choice, not a server guarantee.

------------------------------------------------------------------------

# Event Screen Architecture

The event screen should be status-aware:

``` text
┌─────────────────────────────────┐
│ Aura Bangkok (Sat)          ♡   │
│ 29 Aug • 11:00 AM               │
│ Bangkok                         │
└─────────────────────────────────┘

  Join  Prep  Ready  Play  Results  Done
   ●─────●─────●──────●──────●──────●

───────────────────────────────────

        STATUS-SPECIFIC CONTENT

───────────────────────────────────
```

## Member

``` text
JOIN
→ Members + Guest Players

PREPARATION
→ Waiting message

READY_TO_PLAY
→ My Team

PLAYING
→ My Matches

AFTER_MATCH
→ Standings + Payment

DONE
→ Rating
```

## Admin / Owner

``` text
JOIN
→ Manage Members + Guest Approval

PREPARATION
→ Create / Edit Teams (Shuffle or Manual)

READY_TO_PLAY
→ Team List + Ready to Play confirmation

PLAYING
→ Manage Matches + Results

AFTER_MATCH
→ Standings + Payments

DONE
→ Event Summary + Reviews
```

------------------------------------------------------------------------

# Profile API

> ⚠️ **None of the field names below exist.** The profile endpoint is
> built, but returns a different set of statistics under different names.
> Read this section as a target, not as the contract.

**Target** (this document):

| Field | Description | Status |
|---|---|---|
| `group_count` | Number of groups associated with the user | ❌ not built |
| `joined_event_count` | Number of events joined by the user | ⚠️ exists as `matchesPlayed` |
| `points` | User's accumulated points | ❌ not built — no points system anywhere |
| `followers_count` | Number of users following the user | ⏭️ **SKIPPED** (followers) |

**What `GET /users/:id/profile` actually returns today** under
`statistics`, from `UsersService.buildStatistics`:

``` json
{
  "matchesPlayed": 0,
  "wins": 0,
  "mvpCount": 0,
  "avgRating": 0
}
```

Only `matchesPlayed` is real — it counts `EventPlayer` rows with
`status: 'joined'`, which is the same quantity this document calls
`joined_event_count`. `wins` and `mvpCount` are hardcoded `0` pending
after-match results; `avgRating` is hardcoded `0` pending ratings
(⏭️ skipped).

**Two decisions needed before implementing the target shape:**

1. **Naming convention.** This document uses `snake_case`; every other
   field in the API is `camelCase` (`joinedCount`, `maxPlayers`,
   `profileImage`, `matchesPlayed`). Adopting `snake_case` here would make
   the profile endpoint the only inconsistent one. Recommend
   `groupCount` / `joinedEventCount` / `points` / `followersCount`.
2. **Renaming vs adding.** `matchesPlayed` is live and may already be
   consumed by the app. Renaming it to `joined_event_count` is a breaking
   change; adding the new field alongside is not. Recommend adding, then
   removing `matchesPlayed` in a later release.

`points` needs a scoring rule defined before it can be built — nothing in
this document or the codebase says what earns a point.

**Example response** (target shape, once implemented):

``` json
{
  "group_count": 0,
  "joined_event_count": 0,
  "points": 0,
  "followers_count": 0
}
```

------------------------------------------------------------------------

# Follow User

> ⏭️ **SKIPPED** — out of scope, zero code today. There is no follower
> relationship, no follow endpoint, and no `followers_count` anywhere.
> See Implementation Status.

The system should provide an API for following another user.

The API should handle: - Sending a follow request where required. -
Accepting/rejecting requests where applicable. - Creating the
follower relationship. - Returning the user's follower count.

The exact behavior should follow the application's privacy and event
participation rules — for example, a private profile or private
group may require the target user/owner to accept a follow or join
request rather than creating the relationship immediately.

------------------------------------------------------------------------

# Private Groups

Groups can be marked private. Privacy affects *visibility*, not
*discoverability*:

| Rule | Status |
|---|---|
| A private group **is still searchable** | ✅ **implemented 2026-08-26** |
| A private group **hides its event listing** from non-members | ✅ **implemented 2026-08-26** — `403` |
| A private group **hides its member listing** from non-members | ✅ **implemented 2026-08-26** — `403` |

All three rules now hold. Approval is the gate throughout: a *pending*
join request is not enough, matching how a public group's individually
private events already behaved.

In practice: a non-member can find a private group by search and see
that it exists, but cannot see its events or members until they join
(or their join/follow request is accepted, per the group's settings).

## ✅ "Still searchable" — implemented (it did reverse a deliberate decision)

`GroupsService.search` filters `{ isPrivate: false }` and is commented
*"Public discovery: private groups are never searchable."* So a private
group is currently **invisible** to search, which is the opposite of the
rule above.

This is not an oversight to patch — it was a choice, and reversing it is a
product decision with a real consequence: **a private group's name and
handle become enumerable by anyone.** Substring search means `?q=a` would
list a large share of all private groups. If that is acceptable because
the *contents* stay hidden, the change is a one-line filter removal. If it
is not, this rule should be dropped from the document instead.

**Decision: implemented as written here.** The enumeration cost was accepted
because the group's *contents* are now genuinely protected — which they were
not before, when `isPrivate` guarded discovery and nothing else. Two
mitigations went in alongside: search returns a reduced card with no
`inviteCode`, and an empty query returns `[]` rather than an arbitrary 20
groups.

## ✅ Event listing — now gated per-group as well as per-event

`EventsService.listByGroup` decides visibility from the **event's**
`isPublic` flag and never reads the **group's** `isPrivate` flag — it
selects only `_id` off the group. So a non-member of a private group still
sees that group's *public* events.

**Implemented.** `listByGroup` now reads `isPrivate` and throws `403` for a
non-approved caller. The two flags interact as this document specifies: a
public event inside a private group is **not** visible to a non-member —
the group's privacy wins, so a private group hides its whole schedule.

## ✅ Member listing — gate added, email leak closed

`GET /groups/:id/members` has **no membership check** — any authenticated
user can list any group's members, private or not. Worse, the query
populates `'name email profileImage'`, so it returns **member email
addresses**.

Both halves are now fixed. `email` is no longer populated (only
`name`/`username`/`displayName`/`profileImage`), and a private group's
member list requires approved membership. A public group's member list
stays open to any authenticated caller, which is unchanged.

------------------------------------------------------------------------

# UX Principles

1.  Show only actions relevant to the current status.
2.  Separate Member and Admin/Owner permissions clearly.
3.  Never expose team-management controls to normal members.
4.  Always identify guest players visually.
5.  Pending guests must not affect playable player counts.
6.  Approved guests participate like normal event participants.
7.  Use one clear primary action per status (e.g. `Ready to Play` is
    Admin/Owner-only and commits the event to the next stage).
8.  Confirm destructive actions such as removing members, rejecting
    guests, or committing `Ready to Play`.
9.  Do not expose result editing in the member UI.
10. After completion, focus on ratings and the event summary.
11. Private groups hide events and members from non-members, but
    remain searchable.

------------------------------------------------------------------------

# Implementation Priority

## Phase 1 --- Join

-   Member registration
-   Member list
-   Guest `+1 / +2`
-   Guest approval/rejection
-   Member management

## Phase 2 --- Preparation & Ready to Play

-   Team creation
-   Shuffle teams
-   Manual team editing
-   Guest inclusion
-   Ready to Play confirmation

## Phase 3 --- Playing

-   Match creation
-   Match display
-   Result entry
-   Result editing

## Phase 4 --- After Match

-   Standings — **built**
-   ~~Payment tracking~~ — ⏭️ **SKIPPED**
-   ~~Guest payment support~~ — ⏭️ **SKIPPED** (payments)

## Phase 5 --- Done

-   Event completion — **built** (`done` status)
-   ~~Ratings~~ — ⏭️ **SKIPPED**
-   Event summary — not built (no "limited" variant; `GET /events/:id`
    returns everything)
-   ~~Reviews~~ — ⏭️ **SKIPPED** (ratings)

## Phase 6 --- Profile & Social

-   Profile statistics API — exists, but **every field name differs**
    from this doc
-   ~~Follow user API~~ — ⏭️ **SKIPPED**
-   Private group visibility rules — not built, and one rule in this doc
    contradicts the code (see Implementation Status)

------------------------------------------------------------------------

# Core Rule

> A guest player is an event participant, but not a KickR application
> user.

This distinction must remain consistent across the database,
permissions, teams, matches, results, standings, payments, and UI.
