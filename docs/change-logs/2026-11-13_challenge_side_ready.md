# 2026-11-13 — Group challenge: both sides ready → ready_to_play

After the proposal is accepted, each group's owner/admin invites their own
players. When a group's squad is final, its admin marks the side **ready**.
Once **both** groups are ready, the event moves `join → ready_to_play` on its
own, and the two side teams are built from the roster. Nobody has to create
teams by hand.

---

## New: POST /events/:id/side/ready

Caller: owner/admin of one of the two groups. They mark **their own** side.

```json
{ "ready": true }
```

| Field     | Type     | Notes                                                                                  |
| --------- | -------- | -------------------------------------------------------------------------------------- |
| `ready`   | boolean  | Optional, default `true`. `false` takes readiness back (only while the event is `join`). |
| `groupId` | ObjectId | Optional. Only needed when the caller is owner/admin of **both** groups.              |

To mark a side ready:

- the event is a challenge, its proposal is `accepted`, and it is in `join`
- that side has **at least 1 player who accepted** the invitation
- that side has **no unanswered invitations** (wait for them, or unassign those players)

Responses:

```json
// first side
{ "message": "Your side is ready — waiting for the other group", "ready": true, "status": "join" }

// second side: the event moves to ready_to_play
{ "message": "Both groups are ready — the match is ready to play", "ready": true, "status": "ready_to_play" }

// ready: false
{ "message": "Your side is no longer ready", "ready": false }
```

Errors:

- `400`: not a challenge event, proposal not accepted, event not in `join`, no
  accepted players on the side, invitations still unanswered, or `groupId` is
  not one of the two groups
- `403`: caller is not an owner/admin of either group (or of the given `groupId`)

Notifications:

- The other group's admins get "Opponent is ready" or "Opponent not ready".
- When the event moves to `ready_to_play`, every player on the roster gets the
  usual status notification.

## When both sides are ready

1. `status` becomes `ready_to_play`.
2. Two teams are created, one per group, named by the agreed jersey colours
   (challenger first). Each group's accepted players go into their own team,
   the same as `POST /events/:id/shuffle`.
3. If the automatic team build fails, the status change still stands, and an
   organizer can still generate or shuffle teams by hand in `ready_to_play`.

## New event fields

| Field             | Type          | Notes                                       |
| ----------------- | ------------- | ------------------------------------------- |
| `hostReadyAt`     | Date \| null  | When the `groupId` side marked ready.       |
| `opponentReadyAt` | Date \| null  | When the `opponentGroupId` side marked ready. |

Both are `null` on normal events.

## Changed behaviour (challenge events only)

- **A roster change clears that side's ready flag.** This happens when someone
  is invited (`POST /events/:id/players/assign`), accepts an invitation, is
  unassigned, or is removed. The admin has to mark the side ready again.
- **`PATCH /events/:id/status` with `join → ready_to_play` now returns `400`.**
  Use `POST /events/:id/side/ready`.
- **`ready_to_play → join` (revert)** clears both ready flags and deletes the
  auto-built teams, so the squads can be edited again.
- **`DELETE /events/:id/players/:userId/assign` now only works in `join`.**
  In `ready_to_play` the roster is frozen (`400`). Move the event back to
  `join` to change it.

## App flow

1. The proposal is accepted.
2. Each side's admin invites players: `POST /events/:id/players/assign`. Only
   that group's own members can be invited (load them from
   `GET /groups/{sideGroupId}/members`).
3. Players accept: `POST /events/:id/invitation/respond`.
4. Each side's admin taps "Ready": `POST /events/:id/side/ready`.
5. When the second side is ready, the event is `ready_to_play` and the teams
   exist. Show them with `GET /events/:id/teams`.
