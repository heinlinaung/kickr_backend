# 2026-10-30 — Tournament invitations and group tournament flag

The tournament organizer can now invite **groups (clubs)** to enter a team.
The invited group's owner or an admin accepts by entering the team, which is
registered with `clubId` set to the group. Group detail now says whether the
group has any active tournaments.

All responses below are the payload inside the standard `{ "data": … }`
envelope. All invitation endpoints need a JWT. Errors carry a `code`, like
the other tournament endpoints.

---

## Endpoints

| Method | Path                                             | Who               | Purpose                              |
| ------ | ------------------------------------------------ | ----------------- | ------------------------------------ |
| POST   | `/tournaments/:id/invitations`                   | Organizer         | Invite up to 50 groups (207)         |
| GET    | `/tournaments/:id/invitations?status=`           | Organizer         | Sent invitations (all by default)    |
| GET    | `/groups/:groupId/tournament-invitations?status=`| Group owner/admin | Received (`pending` by default)      |
| POST   | `/tournament-invitations/:invitationId/accept`   | Group owner/admin | Register the group's team            |
| POST   | `/tournament-invitations/:invitationId/decline`  | Group owner/admin | Decline (organizer is notified)      |
| DELETE | `/tournament-invitations/:invitationId`          | Organizer         | Revoke a pending invitation (204)    |

`status` filter: `pending`, `accepted`, `declined`, `revoked`, `expired`.

### Changed

- `GET /groups/:id` now returns `hasTournament` (boolean) and
  `tournamentCount`: the group's tournaments in any status except
  `COMPLETED` or `CANCELLED`. List them with `GET /tournaments/group/:groupId`.
- Notifications have a new `type: "tournament"` (`refId` = tournament id),
  sent to a group's owner and admins on invite, and to the organizer on
  decline. Clients that switch on `type` should handle it.

---

## POST /tournaments/:id/invitations

```json
{ "groupIds": ["665f…c5", "665f…c6"], "message": "Bring your best XI!" }
```

Response `207`:

```json
{ "results": [
  { "groupId": "665f…c5", "status": "INVITED", "invitationId": "6720…d0" },
  { "groupId": "665f…c6", "status": "FAILED", "error": { "code": "INVITATION_EXISTS" } }
] }
```

Whole-call errors: `TOURNAMENT_NOT_FOUND`, `NOT_ORGANIZER`,
`TOURNAMENT_CLOSED` (status is not `DRAFT` or `REGISTRATION_OPEN`).

Per-group codes: `GROUP_NOT_FOUND`, `ALREADY_REGISTERED` (the group already
has an approved team in), `INVITATION_EXISTS`, `TOURNAMENT_FULL`.

## GET /groups/:groupId/tournament-invitations

```json
[ {
  "id": "6720…d0", "tournamentId": "6720…aa", "groupId": "665f…c5",
  "invitedBy": "665f…01", "message": "Bring your best XI!",
  "status": "PENDING", "teamId": null, "respondedAt": null, "createdAt": "…",
  "tournament": { "id": "6720…aa", "title": "Summer Cup", "format": "KNOCKOUT",
    "status": "REGISTRATION_OPEN", "startDate": null, "maxTeams": 8,
    "currentTeams": 3, "hostGroupName": "Sunday Ballers" }
} ]
```

The organizer's `GET /tournaments/:id/invitations` returns the same items with
`group: { id, name, handle, logo }` (null if the group was deleted) in place of
`tournament`.

## POST /tournament-invitations/:invitationId/accept

Same body as `POST /tournaments/:id/teams` without `clubId`:

```json
{ "name": "Team Alpha", "players": ["665f…0d", "665f…0e"], "captainId": "665f…0d" }
```

Response: `{ id, status: "ACCEPTED", tournamentId, team }`.

- The invitation is claimed first, so two admins accepting at once register
  one team. If registration then fails, the invitation goes back to `PENDING`.
- `TOURNAMENT_CLOSED`: registration isn't open. The invitation stays pending
  while the tournament is `DRAFT` / `REGISTRATION_CLOSED` (it can reopen) and
  becomes `EXPIRED` once a phase has started, it finished or was cancelled.
- Other errors: `INVITATION_NOT_FOUND` (also when the caller doesn't run the
  invited group, so ids can't be probed), `INVITATION_NOT_PENDING`,
  `TOURNAMENT_FULL`, `ALREADY_REGISTERED`, and the usual `409` when the
  captain already has a team in the tournament.

---

## Join by QR code / share link

Anyone can join a tournament by scanning its QR or opening its link. This
works the same way as the group QR (`/groups/:id/qr` → `/g/:code`).

| Method | Path                          | Auth | Purpose                                  |
| ------ | ----------------------------- | ---- | ---------------------------------------- |
| GET    | `/tournaments/:id/qr`         | JWT  | The share link and code (any user)       |
| GET    | `/t/:code`                    | none | Landing page (HTML) or JSON preview      |
| POST   | `/tournaments/join-by-code`   | JWT  | Register the caller's team via the code  |

`GET /tournaments/:id/qr`:

```json
{ "inviteCode": "K7QM4XPA", "inviteLink": "https://…/t/K7QM4XPA",
  "deepLink": "kickrsport://tournament/6720…aa", "tournamentId": "6720…aa" }
```

- Put `inviteLink` in the QR. It works from any phone camera, and the page
  opens the app through `deepLink`. **The app needs a
  `kickrsport://tournament/<id>` route.**
- The code is 8 characters (no `0 O 1 I L`) and isn't case-sensitive. It is
  created on the first call, stays the same afterwards and never expires.
  Anyone can already register through `POST /tournaments/:id/teams`, so the
  code isn't a secret.
- `GET /t/:code` with `Accept: application/json` returns
  `{ code, deepLink, tournament: { _id, title, format, status, startDate,
  maxTeams, currentTeams, registrationOpen, hostGroup } }`. An unknown code
  returns `404`.
- `POST /tournaments/join-by-code` takes `{ "code": "K7QM4XPA", "name": …,
  "players": […], "captainId"?, "clubId"? }`. It follows the same rules and
  errors as `POST /tournaments/:id/teams`, plus `404 INVALID_INVITE_CODE`.

## Rules

- One pending invitation per group per tournament (partial unique index).
- Pending invitations to tournaments that can no longer take teams become
  `EXPIRED` when the group reads its list.
- Players are not checked against the group's members, same as
  `POST /tournaments/:id/teams`.

## Error codes (new)

| Code                     | HTTP |
| ------------------------ | ---- |
| `NOT_GROUP_ADMIN`        | 403  |
| `INVITATION_NOT_FOUND`   | 404  |
| `INVITATION_EXISTS`      | 409  |
| `INVITATION_NOT_PENDING` | 409  |
| `ALREADY_REGISTERED`     | 409  |
| `TOURNAMENT_CLOSED`      | 409  |
| `TOURNAMENT_FULL`        | 409  |
| `INVALID_INVITE_CODE`    | 404  |

## Data

New collection `tournamentinvitations`, and a new `tournaments.inviteCode`
field with a unique sparse index. Mongoose creates the indexes on boot, so no
migration is needed.
