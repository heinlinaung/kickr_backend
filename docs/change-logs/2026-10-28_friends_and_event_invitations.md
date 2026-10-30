# 2026-10-28 — Friends and event invitations

Users can now send friend requests, view their friends' profiles, awards and
event history, and invite friends to events. **Only a friendship is needed to
invite someone.** The invitee does not have to belong to the event's group,
so this is how people outside a group can join one of its events.

All responses below are the payload inside the standard `{ "data": … }`
envelope. All endpoints require a JWT. IDs are Mongo ObjectIds.

---

## Endpoints

### Friendships

| Method | Path                                   | Who           | Purpose                    |
| ------ | -------------------------------------- | ------------- | -------------------------- |
| POST   | `/friend-requests`                     | Requester     | Send a friend request      |
| GET    | `/friend-requests?direction=`          | Either        | List pending requests      |
| POST   | `/friend-requests/:requestId/approve`  | Addressee     | Accept                     |
| POST   | `/friend-requests/:requestId/reject`   | Addressee     | Decline (not notified)     |
| DELETE | `/friend-requests/:requestId`          | Requester     | Cancel own pending request |
| GET    | `/friends?q=`                          | Any user      | My friends, by name        |
| DELETE | `/friends/:userId`                     | Either friend | Unfriend                   |

### Friend details (all `403 NOT_FRIENDS` unless you are friends)

| Method | Path                       | Returns                                         |
| ------ | -------------------------- | ----------------------------------------------- |
| GET    | `/friends/:userId`         | Profile summary (`bio`, `stats` if public)      |
| GET    | `/friends/:userId/awards`  | Same items as `GET /users/:userId/awards`       |
| GET    | `/friends/:userId/events`  | `?status=upcoming\|past\|all&role=participant\|organizer` |

### Event invitations

| Method | Path                                  | Who     | Purpose                          |
| ------ | ------------------------------------- | ------- | -------------------------------- |
| POST   | `/events/:eventId/invitations`        | Inviter | Invite up to 50 friends (207)    |
| GET    | `/invitations?status=`                | Invitee | `pending` (default), `accepted`, `declined` |
| POST   | `/invitations/:invitationId/accept`   | Invitee | Join the event                   |
| POST   | `/invitations/:invitationId/decline`  | Invitee | Decline (not notified)           |
| DELETE | `/invitations/:invitationId`          | Inviter | Revoke a pending invitation      |

These are separate from the existing `/groups/:id/invitations` (group join
requests) and `/events/:id/invitation/respond` (challenge-event assignment).

---

## Rules

**Invitation checks**, in order. Steps 1-3 fail the whole call; steps 4-7 are
checked for each invitee and reported in `results[]`:

1. Event exists → `EVENT_NOT_FOUND`
2. Inviter joined or organized it → `NOT_EVENT_PARTICIPANT`
3. Event is open: status `join`, start time in the future, not a challenge
   match → `EVENT_CLOSED`
4. Friends → `NOT_FRIENDS`
5. Invitee not already on the roster → `ALREADY_PARTICIPANT`
6. No pending invitation to this event → `INVITATION_EXISTS`
7. A spot is free → `EVENT_FULL`

Group membership is never checked. The invitee gets a push/in-app notification
(`type: event`, `refId: eventId`).

**Accepting** takes a seat with the same atomic capacity check as
`POST /events/:id/join`. If the event is full, the invitation stays `PENDING`.

**Friendships**

- Only one pending request or friendship can exist per pair of users.
- If A sends B a request while B's request to A is pending, they become friends
  immediately (`200`, `status: ACCEPTED`).
- After a rejection, the requester must wait 30 days before sending that user
  another request (`REQUEST_ALREADY_EXISTS`).

**Side effects**

- Unfriending sets every pending invitation between the two users, in both
  directions, to `REVOKED`. Events they already joined are unchanged.
- Pending invitations to events that started, ended, were cancelled or were
  deleted become `EXPIRED` the next time the invitee calls `GET /invitations`,
  or right away if they try to accept.
- If the inviter leaves the event, their pending invitations stay valid.

**Visibility**

- `GET /friends/:userId` follows the friend's privacy settings. If the profile
  is `private`, only the identity card and `friendsSince` are returned.
  `showStats: false` leaves out `stats`. Profiles set to `members` are visible
  to friends.
- `GET /friends/:userId/events` returns only events the caller can see:
  events the caller is on, any event in a group the caller belongs to, and
  `isPublic` events outside private groups. This matches the group event list.
  `canInvite` tells the caller whether they can invite friends to that event
  right now.

**Limits** (rolling 24 h): 50 friend requests and 200 invitations. Going over
the limit returns `429 RATE_LIMITED` with a `Retry-After` header.

---

## Errors

Error bodies carry `code` beside `message`, like Awards and Event Funds:

```json
{ "statusCode": 403, "code": "NOT_FRIENDS", "message": "You are not friends with this user", "timestamp": "…", "path": "…" }
```

Codes: `CANNOT_FRIEND_SELF`, `INVALID_REQUEST` (400); `NOT_FRIENDS`,
`NOT_EVENT_PARTICIPANT`, `NOT_REQUEST_ADDRESSEE`, `NOT_REQUEST_OWNER`,
`NOT_INVITATION_OWNER` (403); `USER_NOT_FOUND`, `EVENT_NOT_FOUND`,
`REQUEST_NOT_FOUND`, `INVITATION_NOT_FOUND` (404); `ALREADY_FRIENDS`,
`REQUEST_ALREADY_EXISTS`, `REQUEST_NOT_PENDING`, `ALREADY_PARTICIPANT`,
`INVITATION_EXISTS`, `INVITATION_NOT_PENDING`, `EVENT_CLOSED`, `EVENT_FULL`
(409); `RATE_LIMITED` (429).

Requests and invitations that belong to other users return the `*_NOT_FOUND`
code rather than a 403, so their ids cannot be probed.

---

## Data

Two new collections: `friendships` (a request and the friendship it becomes
are the same row; `pairKey` + a partial unique index enforces one live row per
pair) and `eventinvitations` (partial unique on `eventId + inviteeId` while
`PENDING`). Indexes are created by Mongoose on boot. No migration is needed.
