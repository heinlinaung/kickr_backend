# 2026-09-22 — event search sees what the caller can see

## The bug

`GET /events/search?q=Aura` returned an empty page while the same caller's
`GET /events` showed "Aura Bangkok Thurday". The event is `isPublic: false`;
search filtered on `isPublic: true` **only**, so a member's own group's
private events were unfindable by name even though the discovery list (fixed
2026-09-21) shows them — the same visibility bug, one endpoint over.

## The fix

Search now applies the SAME three-arm visibility rule as `GET /events`:

```
public  OR  joined by the caller  OR  in a group the caller is an
                                      approved member of
```

- A private group's events are findable by its approved members — and only
  them; pending requesters and strangers still see public events alone.
- Text match, visibility and the pagination keyset each live in `$and`, so
  the disjunctions cannot clobber one another.
- Everything else is unchanged: expired/`done`/`cancelled` hidden unless
  `includeExpired=true`, date-ascending order, `{ items, nextCursor,
  hasMore }` paging.

## Client impact

None required — the same search calls now simply return the caller's own
groups' private events too.
