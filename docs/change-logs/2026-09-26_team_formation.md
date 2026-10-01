# 2026-09-26 — team formation

A team's tactical line-up: who keeps goal and who stands where, set by the
group owner/admin, the event creator, or **that team's captain**.

## `PUT /events/:id/teams/:teamId/formation`

Sets or REPLACES the line-up in one call (no partial edits — a formation is
one coherent picture).

```json
{
  "name": "My 4-4-2",
  "playerCount": 11,
  "formation": "4-4-2",
  "players": {
    "goalkeeper": "<id>",
    "defenders": ["<id>", "<id>", "<id>", "<id>"],
    "midfielders": ["<id>", "<id>", "<id>", "<id>"],
    "forwards": ["<id>", "<id>"]
  }
}
```

(`teamId` lives in the path, not the body.)

### Rules (free-form by design)

- `formation` is any dash-joined positive numbers — it is NOT checked
  against the global list. The numbers must match the sizes of the
  **non-empty** position groups in defenders → midfielders → forwards
  order. Which lines map to which group is the CLIENT's choice: `"2-2"`
  may arrive as defenders+forwards, defenders+midfielders, or
  midfielders+forwards.
- Goalkeeper always required; `segments + goalkeeper = playerCount`.
- No duplicates; everyone placed must be ON this team — a registered
  player (`players`, user ids) or a guest (`guests`, roster-row ids).
- Blocked on archived (`done`/`cancelled`) events.
- 403 for anyone who is not owner/admin/creator/this team's captain
  (captaincy is per-team: `PATCH .../members/:userId/role`).

## `GET /events/:id/teams/:teamId/formation`

Any authenticated user. Position arrays come back **in the order they were
submitted** — the order is the formation. Each slot resolves to:

```json
{ "id": "<id>", "name": "Player Name", "isGuest": false }
```

- A guest slot carries the roster row's id and display name, `isGuest: true`.
- A member who has since left/been deleted keeps their slot with
  `name: null` — never a shifted line-up.
- 404 until a formation has been set.

Also returned: `teamId`, `name` (the label), `formation`, `playerCount`,
`setBy`, `setAt`.

## `GET /formations` — global picker list

Reference data, one row per squad size (5P/6P/7P/8P/11P from the spec),
served in `playerCount` order in exactly the sample shape. Seeded, not
user-editable — and suggestions only: the PUT above accepts any shape whose
arithmetic holds, so editing the list never blocks a line-up.

## Storage

`Team.formation` sub-document (null until set). Slot ids deliberately carry
no `ref` — a slot may hold a User id or an EventPlayer row id, resolved at
read time against the team's two membership arrays.

## Deploy

Run the new seeder once:

```
npx ts-node scripts/seed-formations.ts          # dry run
npx ts-node scripts/seed-formations.ts --apply
```
