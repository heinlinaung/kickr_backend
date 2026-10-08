# 2026-10-08 — Group Challenge

Group A challenges Group B; the accepted challenge grows exactly ONE match
event, negotiated by proposal, with both sides' admins running it and each
side assigning its own players. **One challenge, one event** — a rematch is
a new challenge.

All responses below are shown as the payload inside the standard `{ "data": … }`
envelope. All endpoints require a JWT.

---

## 1. `POST /challenges` — issue a challenge

**Who:** owner/admin of the CHALLENGER group.

**Request**

```json
{
  "challengerGroupId": "68aa01…",
  "challengedGroupId": "68aa02…"
}
```

**Response `201`** — the challenge row:

```json
{
  "_id": "68cc01…",
  "challengerGroupId": "68aa01…",
  "challengedGroupId": "68aa02…",
  "status": "proposed",
  "rejectReason": null,
  "createdBy": "68bb01…",
  "respondedBy": null,
  "respondedAt": null,
  "eventId": null,
  "createdAt": "2026-10-08T07:00:00.000Z",
  "updatedAt": "2026-10-08T07:00:00.000Z"
}
```

**Errors:** `400` self-challenge · `400` "There is already a pending
challenge between these groups" (either direction) · `403` caller is not a
challenger-group owner/admin · `404` unknown group.

**Side effect:** every owner/admin of the challenged group is notified.

---

## 2. `PATCH /challenges/:id/respond` — accept / reject

**Who:** owner/admin of the CHALLENGED group. Only a `proposed` challenge
can be answered; the verdict is final for that challenge.

**Request**

```json
{ "action": "accept" }
```

```json
{ "action": "reject", "reason": "Our squad is away that month" }
```

(`reason` is optional, max 500 chars, used only on reject.)

**Response `200`** — the updated challenge:

```json
{
  "_id": "68cc01…",
  "status": "accepted",
  "rejectReason": null,
  "respondedBy": "68bb02…",
  "respondedAt": "2026-10-08T08:00:00.000Z",
  "…": "other fields as in POST /challenges"
}
```

**Errors:** `400` "already been accepted/rejected" · `403` wrong side ·
`404` unknown challenge.

**Side effect:** challenger-side admins are notified of the verdict.

---

## 3. `GET /challenges?groupId=<id>` — a group's challenges

**Who:** approved members of that group. Both directions, newest first.

**Response `200`**

```json
[
  {
    "_id": "68cc01…",
    "challengerGroupId": { "_id": "68aa01…", "name": "Second FC", "logo": "https://…" },
    "challengedGroupId": { "_id": "68aa02…", "name": "Aura Bangkok", "logo": "https://…" },
    "status": "accepted",
    "rejectReason": null,
    "eventId": "68dd01…",
    "createdAt": "2026-10-08T07:00:00.000Z"
  }
]
```

`eventId` is null until the proposal event exists — the client uses it to
jump from the challenge card to the match.

**Errors:** `400` malformed groupId · `403` not a member.

---

## 4. `POST /challenges/:id/event` — propose the match event

**Who:** owner/admin of EITHER group, once the challenge is `accepted`,
and only once per challenge.

**Request** — every normal event-create field works (title, description,
date, duration, maxPlayers, price, locationId, sportType/subType, …) plus
the two kit colors:

```json
{
  "title": "Second FC vs Aura Bangkok",
  "date": "2026-10-20T13:00:00.000Z",
  "duration": 90,
  "maxPlayers": 22,
  "price": 150,
  "locationId": "68ee01…",
  "challengerColor": "red",
  "challengedColor": "white"
}
```

`isPublic` and `groupId` are ignored if sent: the event is FORCED private
and belongs to the proposer's group, with the other side on
`opponentGroupId`.

**Response `201`** — a normal event document plus the challenge fields:

```json
{
  "_id": "68dd01…",
  "title": "Second FC vs Aura Bangkok",
  "status": "join",
  "isPublic": false,
  "groupId": "68aa01…",
  "type": "challenge",
  "challengeId": "68cc01…",
  "opponentGroupId": "68aa02…",
  "proposedStatus": "proposed",
  "proposalRejectReason": null,
  "challengeColors": { "challengerColor": "red", "challengedColor": "white" },
  "…": "all other normal event fields"
}
```

**Errors:** `400` challenge not accepted / was rejected · `400` "one
challenge, one match" (event already exists) · `400` weekly plan limit
reached (a challenge event counts like any event) · `403` caller runs
neither group.

**Side effect:** the opposing side's admins are notified to review.

---

## 5. `PATCH /events/:id/proposal/review` — the other side's verdict

**Who:** owner/admin of the group that did NOT create the event — the
proposer cannot accept their own terms.

**Request**

```json
{ "action": "accept" }
```

```json
{ "action": "reject", "reason": "date change need" }
```

**Response `200`** — the event with `proposedStatus` updated:

```json
{
  "_id": "68dd01…",
  "proposedStatus": "rejected",
  "proposalRejectReason": "date change need",
  "…": "rest of the event document"
}
```

On `accept`, `proposedStatus` becomes `"accepted"` and the event runs the
normal lifecycle from `status: "join"`.

**Errors:** `400` not a challenge event / already reviewed · `403` caller
is on the proposing side or runs neither group · `404` unknown event.

**While `proposedStatus !== "accepted"`** every downstream call returns
`400 "The match proposal has not been accepted by the other group yet"`:
status transitions, player assignment, team generation, shuffle.

---

## 6. `POST /events/:id/proposal/resubmit` — re-propose after editing

**Who:** either side's organizer. Only a REJECTED proposal can be
resubmitted — first fix the event with the normal `PATCH /events/:id`
(both sides' admins are organizers), then resubmit.

**Request:** empty body.

**Response `200`** — the event back in review:

```json
{
  "_id": "68dd01…",
  "proposedStatus": "proposed",
  "proposalRejectReason": null,
  "…": "rest of the event document"
}
```

**Errors:** `400` "still awaiting review" / "already accepted" · `403` not
an organizer.

**Side effect:** the opposing side's admins are re-notified.

---

## 7. `POST /events/:id/players/assign` — build your side's squad

**Who:** owner/admin of either group; the caller's SIDE is the group where
they hold that role. Every assignee must be an approved member of that
side. Proposal must be accepted; event must still be in `join`.

**Request**

```json
{ "userIds": ["68bb10…", "68bb11…", "68bb12…"] }
```

**Response `200`**

```json
{
  "message": "2 player(s) assigned",
  "assigned": ["68bb10…", "68bb11…"],
  "skipped": ["68bb12…"]
}
```

`skipped` = already on the roster (idempotent re-assignment). Roster rows
are created with `status: "joined"` and `groupId` = the caller's side;
`joinedCount` is incremented; each assigned player is notified. No minimum
or maximum squad size.

**Errors:** `400` not a challenge event / proposal not accepted / roster
closed / "'<id>' is not an approved member of your group" · `403` caller
runs neither side.

**Closed on challenge events** (each returns `400` pointing at the
admins): `POST /events/:id/join`, `POST /events/:id/leave`, guest adding.

---

## 8. `DELETE /events/:id/players/:userId/assign` — unassign

**Who:** any organizer (either side's owner/admin, or the creator).

**Response `200`**

```json
{ "message": "Player unassigned" }
```

The roster row flips to `cancelled` and `joinedCount` decrements.

**Errors:** `400` not a challenge event · `404` "That player is not
assigned to this event".

---

## 9. Teams, formation, shuffle on a challenge event

- `POST /events/:id/teams/generate` — `teamsCount` MUST be 2 (`400 "A
  challenge event always has exactly 2 teams"`); the two teams are named by
  the kit colors, challenger's first.
- `POST /events/:id/shuffle` — team count locked to 2 and **the clubs are
  never mixed**: group A's assigned players land on the challenger-color
  team, group B's on the challenged-color team. Match count still derives
  from event duration ÷ match duration.
- Manual team edits (`PATCH /events/:id/teams/:teamId`) and formations
  (`PUT /events/:id/teams/:teamId/formation`) work exactly as on normal
  events — rostered players only.

## Reading challenge events

- `GET /events/:id` returns the challenge fields (`type`, `challengeId`,
  `opponentGroupId`, `proposedStatus`, `proposalRejectReason`,
  `challengeColors`) alongside the normal detail payload.
- Members of EITHER group see the event in `GET /events` and
  `/events/search` (new `opponentGroupId` visibility arm). It is never
  public; roster rows carry each player's side as `groupId`.

## Permissions model

Organizer rights are DERIVED, not stamped: owner/admin of either group
(one `$in` query over `groupId` + `opponentGroupId`) plus the creator, so
group role changes take effect immediately.

## Notifications

Challenge created → challenged admins · verdict → challenger admins ·
proposal created/resubmitted → opposing admins · proposal verdict →
proposer admins · assignment → each assigned player.

## Deploy

No seeder, no env change, no migration — all new fields default null /
'normal' on existing documents.
