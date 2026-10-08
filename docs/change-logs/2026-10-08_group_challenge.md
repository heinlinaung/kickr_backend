# 2026-10-08 — Group Challenge

Group A challenges Group B; the accepted challenge grows exactly ONE match
event, negotiated by proposal, with both sides' admins running it and each
side assigning its own players. **One challenge, one event** — a rematch is
a new challenge.

## The handshake — `challenges` collection

- `POST /challenges` `{challengerGroupId, challengedGroupId}` — challenger
  group's owner/admin. One PENDING challenge per group pair (either
  direction) at a time. Notifies the challenged side's admins.
- `PATCH /challenges/:id/respond` `{action: accept|reject, reason?}` —
  challenged group's owner/admin; reason optional; the verdict is final for
  that challenge. Notifies the challenger side.
- `GET /challenges?groupId=` — both directions, newest first, members only.
  Rows populate both groups' name/logo and carry `eventId` once the match
  exists.

## The proposal event

- `POST /challenges/:id/event` — either side's owner/admin, challenge must
  be `accepted`, and only once. Body = normal event create fields PLUS
  `challengerColor` / `challengedColor` (each side's kit). Forced
  `isPublic: false`; stored with `type: 'challenge'`, `challengeId`,
  `opponentGroupId`, `proposedStatus: 'proposed'`.
  **Counts toward the creator's weekly plan limit like any event.**
- `PATCH /events/:id/proposal/review` `{action, reason?}` — owner/admin of
  the side that did NOT create it (the proposer cannot accept their own
  terms). Reject stores the reason ("date change need", "color conflict").
- `POST /events/:id/proposal/resubmit` — after a rejection, the proposer
  edits the event (PATCH /events/:id — both sides' admins are organizers)
  and explicitly resubmits; the reviewer is re-notified. An edit alone
  never reopens review.
- Until accepted, the event is INERT: no status transitions, no roster, no
  teams, no shuffle (400 "proposal has not been accepted").

## Permissions

Organizer rights on a challenge event are DERIVED, not stamped: owner/admin
of either group (one `$in` query over `groupId` + `opponentGroupId`) plus
the creator. Group role changes take effect immediately.

## Roster — assigned, never joined

- `POST /events/:id/players/assign` `{userIds[]}` — the caller's side is
  the group (of the two) where they are owner/admin; every assignee must be
  an approved member of THAT side. Roster rows carry `groupId` (the side);
  no min/max squad size; players are notified; already-assigned ids are
  skipped. `DELETE /events/:id/players/:userId/assign` undoes one.
- Self-join, leave and guests are all CLOSED on challenge events (400 with
  a message pointing at the admins).

## Teams & shuffle

- Team generation is locked to **exactly 2 teams**, named by the two kit
  colors (`challengerColor` first).
- `POST /events/:id/shuffle` on a challenge event does NOT deal randomly:
  group A's assigned players go to team A, group B's to team B — the clubs
  are never mixed. Match count still derives from event duration ÷ match
  duration; team count is always 2.
- Manual team edits and formations work as normal (rostered players only).

## Visibility

Members of EITHER group see the challenge event in GET /events and
/events/search (new `opponentGroupId` visibility arm). It is never public.

## Notifications

Challenge created → challenged admins; verdict → challenger admins;
proposal created/resubmitted → opposing admins; proposal verdict → proposer
admins; assignment → each assigned player.

## Deploy

No seeder, no env change, no migration — all new fields default null /
'normal' on existing documents.
