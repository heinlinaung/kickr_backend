# Global football teams API (for the Flutter app)

Reference data: the list of real-world clubs a user picks a supported team
from.

> ⚠️ **These are NOT KickR teams.** A KickR team is a per-event squad with a
> roster, under `GET /events/:id/teams`. This collection is static reference
> data about real clubs and has nothing to do with an event.

> ⚠️ Written from source, not captured live.

---

## `GET /global-football-teams`

Requires a bearer token. Returns every club in display order.

```bash
curl -s "$URL/global-football-teams" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": [
    { "_id": "68b9c1aa22bb33cc44dd0001", "name": "Manchester United", "sortOrder": 1 },
    { "_id": "68b9c1aa22bb33cc44dd0002", "name": "Liverpool", "sortOrder": 2 },
    { "_id": "68b9c1aa22bb33cc44dd0003", "name": "Arsenal", "sortOrder": 3 }
  ]
}
```

| Field | Notes |
|---|---|
| `_id` | The club's identity. **Store this**, not the name, if you ever persist a user's choice — names get corrected, ids do not. |
| `name` | Display label. Unique across the collection. |
| `sortOrder` | Display position. The list is already sorted by it; you do not need to re-sort. |

### Not paginated, on purpose

It is a fixed list of about twenty clubs meant to fill one picker. Paginating
it would force every consumer to loop to render a dropdown. Unlike
`/notifications` or the search endpoints, this does not grow without bound.

If it ever spans multiple leagues, the useful addition is a `?country=` or
`?league=` filter rather than pages.

### Ordering

`sortOrder` ascending, then `name` as a tiebreaker.

The order is **by league standing, not alphabetical** — Manchester United comes
before Arsenal. That is why `sortOrder` exists as its own field rather than
sorting by `name`, and why it is not derived from `_id` (an ObjectId sorts by
creation time, so reordering would mean re-inserting).

The `name` tiebreaker matters: two clubs sharing a `sortOrder` would otherwise
come back in whatever order the storage engine picks, which can differ between
two identical requests.

### Read-only

There is no create, update or delete. Rows are seeded server-side by
`scripts/seed-global-football-teams.ts`, because this is reference data rather
than user content.

## Gotchas checklist

- [ ] **Not KickR teams.** Do not confuse this with `GET /events/:id/teams`.
- [ ] **Persist `_id`, never `name`.** A club rename would orphan a stored name.
- [ ] **Already sorted** by `sortOrder` — re-sorting alphabetically undoes the
      intended league order.
- [ ] **Not paginated**, and there is no `nextCursor`. `data` is a plain array
      here, unlike `/notifications`.
- [ ] **An empty array means the collection has not been seeded**, not that the
      request failed. Run the seed script.
- [ ] Requires auth like every other route — a missing token is a 401.
