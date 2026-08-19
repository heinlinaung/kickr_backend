# Group Team Creation & Tournament Registration

## Overview

Teams are created and managed at the **Group level**.

A team belongs to a Group and can later participate in one or more tournaments. A tournament should **not create a new team**. Instead, a tournament allows existing teams from other groups to register and join.

The overall structure is:

```text
Group
|
+-- Members
|
+-- Teams
|   |
|   +-- Team A
|   +-- Team B
|   +-- Team C
|   |
|   +-- Create Team
|
+-- Tournaments
    |
    +-- Tournament A
    +-- Tournament B
    +-- Create Tournament
```

---

# 1. Roles

## Group Admin

The Group Admin can:

- Create a team
- Edit team information
- Add team members
- Remove team members
- Manage team captain
- View all teams in the group
- Delete/archive a team when appropriate
- Register a group team for a tournament

## Group Member

A Group Member can:

- View teams in the group
- View team information
- View their own team
- Join a team if permitted by the group/team rules

## Tournament Organizer

The Tournament Organizer can:

- Create a tournament
- Share the tournament QR code
- Share the tournament join link
- Receive team registration requests
- Approve or reject teams
- Manage participating tournament teams

---

# 2. Team Ownership

A team belongs to exactly one Group.

```text
Group
  |
  +-- Team A
  |
  +-- Team B
  |
  +-- Team C
```

A tournament references teams; it does not own or recreate them.

```text
Group A
  |
  +-- Team Red
  |
  +-- Team Blue
          |
          | register
          v
     Tournament
          |
          +-- Team Red
          +-- Team Blue
          +-- Team Green
```

This allows the same team to participate in multiple tournaments without creating duplicate teams.

---

# 3. Create Team

Team creation should be available from:

```text
Group
  |
  +-- Teams
        |
        +-- Create Team
```

The Admin selects **Create Team**.

---

# 4. Team Information

The Create Team screen should contain the following fields.

## 4.1 Team Name

**Field:** `Team Name`

**Required:** Yes

Example:

```text
Aura United
```

The team name should be unique within the Group.

---

## 4.2 Team Logo

**Field:** `Team Logo`

**Required:** No

Recommended formats:

```text
JPG
JPEG
PNG
```

The logo is displayed on:

- Team profile
- Team lists
- Tournament team lists
- Fixtures
- Standings
- Match results

---

## 4.3 Team Captain

**Field:** `Team Captain`

**Required:** Yes

The captain should be selected from the Group members.

Example:

```text
Team Captain
John
```

A team should have one primary captain.

---

## 4.4 Team Members

**Field:** `Team Members`

**Required:** Yes

The Admin can select members from the Group.

Example:

```text
Aura United

Captain
- John

Players
- David
- Michael
- Alex
- Peter
- James
```

Only members belonging to the Group should be available for selection.

---

# 5. Create Team Flow

```text
Group
  |
  v
Teams
  |
  v
Create Team
  |
  v
Enter Team Information
  |
  +-- Team Name
  +-- Team Logo
  +-- Team Captain
  +-- Team Members
  |
  v
Review Team
  |
  v
Create Team
  |
  v
Team Created
```

---

# 6. Create Team Screen

Example:

```text
Create Team

Team Logo
[ Upload ]

Team Name
[ Aura United ]

Team Captain
[ John v ]

Team Members
[ + Add Members ]

Selected Members
- John (Captain)
- David
- Michael
- Alex
- Peter

[ Create Team ]
```

---

# 7. Team Details

After the team is created, the Group Admin can open the team.

```text
Aura United
------------------------------

Team Logo

Captain
John

Players
1. John
2. David
3. Michael
4. Alex
5. Peter

Group
Aura Bangkok

[ Edit Team ]
[ Add Member ]
```

---

# 8. Team Management

The Group Admin can manage the team after creation.

```text
Team
|
+-- Team Information
|
+-- Captain
|
+-- Members
|
+-- Edit Team
|
+-- Add Member
|
+-- Remove Member
|
└-- Archive Team
```

### Add Member

```text
Team
  |
  v
Add Member
  |
  v
Select Group Member
  |
  v
Add to Team
```

### Remove Member

```text
Team
  |
  v
Select Member
  |
  v
Remove Member
```

The system should ask for confirmation before removing a member.

---

# 9. Team and Tournament Relationship

A Team is created once at the Group level.

It can then register for multiple tournaments.

```text
Group
|
+-- Team A
|     |
|     +---- Tournament 1
|     |
|     +---- Tournament 2
|     |
|     +---- Tournament 3
|
+-- Team B
      |
      +---- Tournament 1
      |
      +---- Tournament 4
```

The tournament stores the team's participation, but the original team remains owned by the Group.

---

# 10. Joining an External Tournament

A team from another Group can join a tournament using the organizer's QR code or join link.

Example:

```text
Tournament Organizer
        |
        v
Create Tournament
        |
        v
Generate QR Code
        |
        v
Share QR Code
        |
        v
Other Group / Team
        |
        v
Scan QR Code
        |
        v
Tournament Details
        |
        v
Join Tournament
        |
        v
Select Existing Team
        |
        v
Submit Join Request
```

---

# 11. Existing Team Registration

When a team selects **Join Tournament**, the system should show teams that belong to the current user's Group.

Example:

```text
Join Tournament

Select Team

( ) Aura United
( ) Bangkok Stars
( ) Bangkok Warriors

[ Continue ]
```

The user selects the team they want to register.

Then:

```text
Aura United

Tournament
Aura Futsal Cup 2026

Play Date
6 November 2026

Registration Deadline
1 November 2026

Entry Fee
THB 1,500 / team

[ Submit Join Request ]
```

---

# 12. Create a Team Before Joining

If the Group does not have a team, provide an option to create one.

```text
Join Tournament

You don't have a team yet.

[ Create Team ]

or

[ Select Existing Team ]
```

The flow becomes:

```text
Tournament
    |
    v
Join Tournament
    |
    v
No Existing Team
    |
    v
Create Team
    |
    v
Team Created in Group
    |
    v
Register Team for Tournament
```

The newly created team remains a Group team and is then registered with the tournament.

---

# 13. Tournament Organizer Team Approval

After a team submits a registration request, the tournament organizer receives the request.

```text
Tournament
|
+-- Tournament Teams
    |
    +-- Confirmed
    |   +-- Team Red
    |   +-- Team Blue
    |
    +-- Pending
        +-- Aura United
        +-- Bangkok Stars
```

The organizer can:

```text
[ Approve ]    [ Reject ]
```

If approved:

```text
Pending
   |
   v
Approved
   |
   v
Tournament Teams
```

The team becomes an official participant in that tournament.

---

# 14. Team Registration Status

Recommended statuses:

```text
Not Registered
      |
      v
Pending Approval
      |
      +---- Approved ----> Joined
      |
      +---- Rejected
```

The team should be able to view its registration status.

---

# 15. Tournament Entry Fee & Prize Pool

## 15.1 Entry Fee per Team

**Field:** `Entry Fee`

**Required:** No (defaults to Free/0 if not set)

Set by the Tournament Organizer during **Create Tournament**.

Example:

```text
Entry Fee
THB 1,500 / team
```

The entry fee is charged **once per team**, not per player. It should be displayed:

- On the Tournament Details screen (before joining)
- On the Join Tournament / Select Team screen
- In the Submit Join Request confirmation

## 15.2 Prize Pool

**Field:** `Prize Pool`

**Required:** No

Set by the Tournament Organizer during **Create Tournament**. Can be entered as a fixed total amount, or optionally broken down by placement.

Example:

```text
Prize Pool
THB 30,000 Total

1st Place   THB 15,000
2nd Place   THB 10,000
3rd Place   THB 5,000
```

The Prize Pool is displayed on:

- Tournament Details
- Tournament public join link / QR landing page
- Standings (once the tournament concludes)

## 15.3 Updated Tournament Details Screen

```text
Aura Futsal Cup 2026
------------------------------

Play Date
6 November 2026

Registration Deadline
1 November 2026

Entry Fee
THB 1,500 / team

Prize Pool
THB 30,000 Total

[ Join Tournament ]
```

## 15.4 Updated Join Request Flow

```text
Select Existing Team
        |
        v
Review Tournament & Fee
        |
        +-- Entry Fee: THB 1,500
        |
        v
Submit Join Request
        |
        v
Payment (if required)
        |
        v
Pending Approval
```

## 15.5 Team Payment Status

When an Entry Fee is set, a team's registration should track payment separately from approval status.

Recommended statuses:

```text
Unpaid
   |
   v
Paid
   |
   v
Payment Confirmed by Organizer
```

Example on the organizer's Pending list:

```text
Pending
+-- Aura United      Fee: Paid
+-- Bangkok Stars    Fee: Unpaid
```

## 15.6 Fee & Prize Pool Business Rules

1. Entry Fee is set once per tournament and applies to every registering team equally.
2. Entry Fee is charged per team, not per individual player.
3. If Entry Fee is 0 or not set, the tournament is treated as free to join.
4. The organizer can optionally require payment confirmation before a team's status moves from Pending to Approved.
5. Prize Pool is informational and does not affect registration flow.
6. Prize Pool can be a single total amount or broken down by placement.
7. Entry Fee and Prize Pool are tournament-level fields and do not affect the original Group team's information.

---

# 16. Tournament Phases & Format

A tournament can run through one or both of the following phases.

```text
Tournament
   |
   +-- Phases
         |
         +-- League Phase
         |     |
         |     +-- Groups (optional)
         |     +-- Standings
         |     +-- Fixtures / Matches
         |
         +-- Knockout Phase
               |
               +-- Rounds
               |     +-- Round of 16
               |     +-- Quarter Final
               |     +-- Semi Final
               |     +-- Final
               |
               +-- Fixtures / Matches
```

## 16.1 League Phase

Teams are optionally split into **Groups**, play round-robin **Fixtures / Matches** against other teams in their group, and results build a **Standings** table (points, wins, draws, losses, goal difference, etc.).

## 16.2 Knockout Phase

Teams advance through single-elimination **Rounds** (e.g. Round of 16 → Quarter Final → Semi Final → Final), each round made up of **Fixtures / Matches**. Which teams enter the Knockout Phase, and in what seeding, is governed by the tournament's **Qualification Rules**.

## 16.3 Phase Business Rules

1. A tournament can use League Phase only, Knockout Phase only, or both (League Phase feeding into Knockout Phase).
2. Groups are optional within the League Phase; a tournament may run a single combined league table instead.
3. Qualification Rules determine how teams move from the League Phase into the Knockout Phase (e.g. top 2 per group).
4. Once a phase starts, its structure (groups, number of rounds) should not be changed without organizer confirmation.

---

# 17. Important Business Rules

### Team Rules

1. A team belongs to one Group.
2. A team must have a name.
3. A team must have a captain.
4. The captain must be a member of the Group.
5. Team members must belong to the same Group.
6. A team name should be unique within the Group.
7. A member should not be added twice to the same team.
8. A team can have multiple players.
9. A team has one primary captain.
10. Only authorized users can create or edit teams.

### Tournament Rules

1. A tournament does not create or own teams.
2. A tournament references existing Group teams.
3. A team can participate in multiple tournaments.
4. A team can register for a tournament using the QR code or join link.
5. A team cannot register twice for the same tournament.
6. The tournament organizer can approve or reject registration.
7. A team becomes an official tournament participant after approval.
8. Registration closes after the tournament registration deadline.
9. Tournament-specific information should not overwrite the original Group team information.
10. If an Entry Fee is set, it applies uniformly to all teams registering for that tournament.
11. Prize Pool amounts must not be edited after the tournament has started.

---

# 18. Recommended Data Relationship

Conceptually, the relationship should be:

```text
GROUP
  |
  | 1
  |
  | many
  v
TEAM
  |
  | many
  |
  | many
  v
TOURNAMENT
```

A practical database structure can be:

```text
Group
  |
  +-- Team
        |
        +-- TeamMember
        |
        +-- TournamentRegistration
                    |
                    +-- Tournament (Entry Fee, Prize Pool)
                    |
                    +-- Payment Status
```

The `TournamentRegistration` represents the relationship between a Team and a Tournament. It also stores the payment status for that team's Entry Fee, since the same Entry Fee amount is defined once on the Tournament but paid individually per Team.

This is important because the same team can participate in different tournaments.

---

# 19. Complete User Flow

## Group Admin Creates Team

```text
Group
  |
  v
Teams
  |
  v
Create Team
  |
  +-- Team Name
  +-- Logo
  +-- Captain
  +-- Members
  |
  v
Create
  |
  v
Team Created
```

## Organizer Creates Tournament

```text
Group
  |
  v
Tournaments
  |
  v
Create Tournament
  |
  +-- Organizer / Group
  +-- Name
  +-- Description
  +-- Play Date
  +-- Registration Deadline
  +-- Match Duration
  +-- Teams per Group
  +-- Entry Fee per Team
  +-- Prize Pool
  +-- Wallpaper
  |
  v
Create Tournament
  |
  v
QR Code + Join Link
```

*(See Section 15 for Entry Fee / Prize Pool field details.)*

## Another Team Joins

```text
QR Code / Join Link
        |
        v
Tournament Details
        |
        v
Join Tournament
        |
        v
Select Existing Team
        |
        v
Submit Join Request
        |
        v
Pending Approval
        |
        v
Organizer
    /       Approve    Reject
   |          |
   v          v
Joined     Rejected
```

---

# 20. Final Architecture

The recommended structure is:

```text
GROUP
│
├── Members
│
├── Teams
│   │
│   ├── Team A
│   │   ├── Captain
│   │   └── Players
│   │
│   ├── Team B
│   │   ├── Captain
│   │   └── Players
│   │
│   └── Create Team
│
└── Tournaments
    │
    ├── Tournament A
    │   │
    │   ├── Tournament Teams
    │   │
    │   ├── Phases
    │   │   │
    │   │   ├── League Phase
    │   │   │   ├── Groups (optional)
    │   │   │   ├── Standings
    │   │   │   └── Fixtures / Matches
    │   │   │
    │   │   └── Knockout Phase
    │   │       │
    │   │       ├── Rounds
    │   │       │   ├── Round of 16
    │   │       │   ├── Quarter Final
    │   │       │   ├── Semi Final
    │   │       │   └── Final
    │   │       │
    │   │       └── Fixtures / Matches
    │   │
    │   ├── Qualification Rules
    │   │
    │   └── Tournament Settings
    │       ├── Entry Fee per Team
    │       └── Prize Pool
    │
    └── Tournament B


OTHER GROUP
│
└── Teams
    │
    └── Team C
           |
           | Join Tournament A
           v
     Tournament A
           |
           v
   Tournament Registration
           |
           v
        Approved
```

## Key Principle

> **Create and manage Teams inside the Group. Create and manage Tournaments separately. A Tournament allows existing Teams from any Group to register through a QR code or join link.**

This design keeps the Group responsible for team ownership and the Tournament responsible for competition participation.
