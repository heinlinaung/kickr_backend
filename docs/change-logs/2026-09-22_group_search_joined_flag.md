# 2026-09-22 — group search carries the caller's standing

## What changed

Every row of `GET /groups/search` now says where the CALLER stands with that
group:

```json
{
  "items": [
    {
      "_id": "…", "name": "Bangkok FC", "isPrivate": false,
      "joinedByMe": true,
      "memberStatus": "approved"
    },
    { "…": "…", "joinedByMe": false, "memberStatus": "pending" },
    { "…": "…", "joinedByMe": false, "memberStatus": null }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

- **`joinedByMe`** — `true` only for an APPROVED membership, the same meaning
  the flag has on event rows.
- **`memberStatus`** — `'approved' | 'pending' | null`. Carried alongside the
  boolean because a pending join request must render as "Requested", and a
  bare boolean cannot say so.

The client can now render the right CTA per card — **Open** (joined),
**Requested** (pending), **Join / Request to join** (null, with `isPrivate`
deciding the wording) — without a per-row `GET /groups/:id`.

## Implementation notes

- One indexed `groupmembers` query per PAGE (`userId + groupId $in`), not one
  per row.
- Pagination, projection (still no `inviteCode`), and the private-groups-are-
  discoverable rule are unchanged.
