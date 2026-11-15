# 2026-11-10 — Tournament duration and history

Tournaments can now be created with a length in days and a registration deadline. Once a tournament
finishes or runs past its last day, it drops out of the group's tournament
list and shows up in a new history list instead.

---

## Changed: POST /tournaments

New optional fields:

| Field                   | Type    | Notes                                                                |
| ----------------------- | ------- | -------------------------------------------------------------------- |
| `totalDays`             | integer | 1–365. How many days the tournament runs. Omit for no limit.         |
| `registerCloseDuration` | integer | 1–365. How many days registration stays open, from creation. Optional. |

```json
{
  "title": "Summer Cup 2026",
  "groupId": "665f1a2b3c4d5e6f7a8b9c0d",
  "format": "KNOCKOUT",
  "maxTeams": 8,
  "startDate": "2026-07-15T09:00:00.000Z",
  "totalDays": 7,
  "registerCloseDuration": 3
}
```

The registration deadline (creation time + `registerCloseDuration` days) must
not fall after `startDate` or `endDate`. Otherwise the request fails with
`400 INVALID_REQUEST`.

The response (and every tournament document) now includes:

- `totalDays`: as sent, or absent.
- `endDate`: `startDate + totalDays` days, or *creation time* + `totalDays`
  when there is no `startDate`. `null` when `totalDays` was not sent, and on
  tournaments created before this change. These never expire by date.
- `registerCloseDuration`: as sent, or absent.
- `registrationCloseAt`: creation time + `registerCloseDuration` days, or
  `null` (no deadline).

## Registration deadline

Once `registrationCloseAt` has passed, every way of joining refuses new teams,
even though `status` is still `REGISTRATION_OPEN`:

- `POST /tournaments/:id/teams` and `POST /tournaments/join-by-code` →
  `400 "Tournament is not accepting registrations"`
- `POST /tournament-invitations/:id/accept` → `409 TOURNAMENT_CLOSED`
- `GET /t/:code` now returns `registrationCloseAt`, and `registrationOpen` is
  `false` after the deadline.

If the organizer moves the status from `REGISTRATION_CLOSED` back to
`REGISTRATION_OPEN` after the deadline, the deadline is cleared, so
registration really reopens.

## Changed: GET /tournaments/group/:groupId

Now returns only **running** tournaments, meaning status is not `COMPLETED` /
`CANCELLED` **and** `endDate` is `null` or still in the future. The `status`
filter still works inside this set.

`GET /groups/:id` → `hasTournament` / `tournamentCount` use the same rule, so
expired tournaments no longer count.

## New: GET /tournaments/group/:groupId/history

The group's past tournaments: `COMPLETED`, `CANCELLED`, **or** past their
`endDate` (whatever their status). Sorted with the most recent `endDate`
first. Uses the same access rules (private group → approved members only),
`?status=` filter and errors as the active list.

Open one with `GET /tournaments/:id` to see its teams, matches and final
`placements`.

## Notes

- Expiry is computed when the lists are queried. No job changes `status`,
  so an expired tournament keeps the status it had (e.g.
  `LEAGUE_IN_PROGRESS`). Clients can tell it expired from `endDate`.
- Existing tournaments need no migration.
