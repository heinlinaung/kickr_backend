# 2026-10-16 — Challenge unread count

When a group receives a challenge, the challenged group gets an unread
count (badge). It is set when the other group sends the challenge and
cleared when the receiving group reads its challenges.

All responses are shown as the payload inside the standard `{ "data": … }`
envelope. All endpoints require a JWT.

---

## 1. `GET /challenges/unread-count?groupId=<id>` — the badge

**Who:** approved members of that group.

**Response `200`**

```json
{ "groupId": "68aa02…", "count": 2 }
```

Counts only challenges this group RECEIVED (`challengedGroupId`) that
have not been read yet. Challenges the group sent itself never count.

**Errors:** `400` malformed groupId · `403` not a member.

---

## 2. `PATCH /challenges/read?groupId=<id>` — clear the badge

**Who:** owner/admin of the receiving group (they are the ones notified
and the ones who respond). Idempotent; there is no request body.

**Response `200`**

```json
{ "groupId": "68aa02…", "cleared": 2, "count": 0 }
```

`cleared` is how many challenges were flipped to read on this call.

**Errors:** `400` malformed groupId · `403` caller is not an owner/admin.

---

## Behaviour

- `POST /challenges` creates the challenge with `unreadByChallenged: true`,
  so the challenged group's count goes up by one.
- `PATCH /challenges/read` sets `unreadByChallenged: false` on every unread
  challenge the group received, so the count goes back to 0.
- The challenge row (`POST /challenges`, `GET /challenges`) now has a new
  field, `unreadByChallenged` (boolean).

**Client flow:** show `count` as the badge. When an owner/admin opens the
challenge list, call `PATCH /challenges/read`.

## Deploy

No migration needed. The field defaults to `false`, so challenges created
before this change count as read and don't inflate the badge.
