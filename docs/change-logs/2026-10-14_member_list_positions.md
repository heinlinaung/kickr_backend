# 2026-10-14 — footballPosition on member/player list cards

The profile position(s) — goalkeeper, defender, midfielder, forward,
playmaker — now ride along on the populated user card in two lists, so
clients render positions without a profile call per row:

- `GET /events/:id/players` — each registered player's `userId` object
  now carries `footballPosition: string[]`. Guest rows have no user
  document, so their card simply lacks the field.
- `GET /groups/:id/members` — each member's `userId` object carries
  `footballPosition: string[]`. The row's own `role` is UNCHANGED — it
  stays the GROUP role (owner/admin/member); the pitch position lives
  inside the user card.

```json
{
  "userId": {
    "_id": "…", "name": "Hein", "profileImage": "…",
    "footballPosition": ["defender", "midfielder"]
  },
  "role": "member",
  "status": "approved"
}
```

An array (since 2026-10-11) — may be empty for users who never set it.
No deploy steps.
