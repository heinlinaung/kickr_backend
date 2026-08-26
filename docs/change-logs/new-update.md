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

## 🔴 Fix in this document — currently wrong or misleading

- [ ] **The `LEGAL` transitions block lists `['preparation', 'playing']`,
      which now returns `409`.** It was removed on 2026-08-24 so kick-off
      has to pass through `ready_to_play`. A client following this block
      gets a hard error.
- [ ] **The `LEGAL` block omits `ready_to_play` entirely**, contradicting
      this document's own opening line, which lists six statuses.
- [ ] **The `LEGAL` block is missing the reverse edge
      `['ready_to_play', 'preparation']`** — used to send a
      reviewed-but-wrong team set back to be re-shuffled.
- [ ] **Remove the resolved note** beginning *"If it is persisted as its
      own `EventStatus` value…"*. It is persisted as its own value; the
      note shipped.
- [ ] **Add the Referee role.** Referee is implemented — a group referee
      may enter match scores (`SCORER_ROLES = ['owner','admin','referee']`).
      This document has only Member and Admin/Owner, so the feature-matrix
      rows "Add result" and "Edit result" are wrong. The 2026-08-20 doc had
      a Referee flow; this one dropped it.
- [ ] **Profile API field names match nothing in the code.** This doc asks
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

## 🟠 Needs a decision — this doc contradicts the code on purpose?

- [ ] **"A private group is still searchable."** The code deliberately
      does the opposite: `GroupsService.search` filters
      `{ isPrivate: false }`, commented *"Public discovery: private groups
      are never searchable."* Either this doc is specifying a behaviour
      change, or it is an error. Confirm before anyone implements it.

## 🔴 Fix in the code — independent of everything else here

- [ ] **`GET /groups/:id/members` has no access gate and returns member
      email addresses.** Any authenticated user can list any group's
      members, private or not, and the query populates
      `'name email profileImage'`. This is a live privacy leak and a small
      fix. Notable because `/users/search` goes out of its way never to
      return an email.

## 🟡 Specified here but not built — safe to build, nothing exists yet

- [ ] **Private group hides its event listing from non-members.** Gating
      today is per-**event** (`isPublic`), never per-**group**
      (`isPrivate`) — `listByGroup` reads only `_id` off the group. A
      non-member of a private group still sees that group's public events.
- [ ] **Private group hides its member listing from non-members.** No gate
      at all today (see the leak above).
- [ ] **Event-level "Make organizer"** — does not exist.
- [ ] **Admin "Remove from event"** — does not exist. `DELETE
      /events/:id/join` is *self*-leave only, so an organizer cannot
      remove a player.

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
- Manage payment status for each players.
- View the final event summary and ratings.

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
  ['preparation', 'playing'],
  ['preparation', 'join'],
  ['playing', 'after_match'],
  ['after_match', 'done'],
];
```

`['preparation', 'join']` is now a legal transition — an Admin/Owner
can reopen registration directly from Preparation if the roster needs
to change before teams are finalized.

> **Note:** `ready_to_play` is documented below as its own stage
> because the UI, content, and available actions on it are distinct
> from `preparation`. If it is persisted as its own `EventStatus`
> value (rather than a UI sub-state reached once teams are confirmed),
> extend `LEGAL` with `['preparation', 'ready_to_play']` and
> `['ready_to_play', 'playing']`.

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

  Feature                Member    Admin / Owner
  --------------------- --------- ---------------
  View members              ✓            ✓
  Join / leave              ✓            ✓
  Add +1 guest              ✓            ✓
  Add +2 guest              ✓            ✓
  Approve guest            ---           ✓
  Reject guest             ---           ✓
  View guest status         ✓            ✓
  Create teams             ---           ✓
  Shuffle teams            ---           ✓
  Edit teams               ---           ✓
  Ready to Play             ✓*           ✓
  View matches              ✓            ✓
  Create match             ---           ✓
  Add result               ---           ✓
  Edit result               ---           ✓
  View standings            ✓            ✓
  Manage payments          ---           ✓
  View payment status       ✓            ✓
  Rate event                 ✓            ✓
  View event summary     Limited         ✓

`* Member can only *view* the Ready to Play state (own team +
waiting message); only Admin/Owner can trigger the transition.`

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

The profile API should provide the following statistics:

  Field                Description
  --------------------- ----------------------------------------
  `group_count`          Number of groups associated with the user
  `joined_event_count`   Number of events joined by the user
  `points`                User's accumulated points
  `followers_count`      Number of users following the user

Example response:

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

-   A private group **is still searchable** — it can appear in group
    search results.
-   A private group **hides its event listing** from non-members.
-   A private group **hides its member listing** from non-members.

In practice: a non-member can find a private group by search and see
that it exists, but cannot see its events or members until they join
(or their join/follow request is accepted, per the group's settings).

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
