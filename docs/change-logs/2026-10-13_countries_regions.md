# 2026-10-13 — Countries & regions reference data

## What changed

New `countries` collection (`src/countries/`). Each document is one country
with its regions embedded:

```json
{ "id": "myanmar", "name": "Myanmar", "sortOrder": 1,
  "regions": [{ "id": "yangon", "name": "Yangon" }, …] }
```

Ids are the lowercase values groups and users already store as `country` /
`city` (e.g. `myanmar` / `yangon`, `thailand` / `chiang mai`). Because those
documents carry the plain string, **ids are immutable**. Only `name` (and
order) can change.

| Method | Path | Auth | What |
| --- | --- | --- | --- |
| GET | `/regions` | public | `{ regions: { myanmar: [{ id, name }], thailand: [...] } }`, countries in display order |
| GET | `/countries` | public | All countries with regions, in display order |
| GET | `/countries/:id` | public | One country |
| POST | `/countries` | superadmin | `{ id?, name, sortOrder?, regions?: [{ id?, name }] }` |
| PATCH | `/countries/:id` | superadmin | `{ name?, sortOrder?, regions? }`. `regions` replaces the whole list |
| DELETE | `/countries/:id` | superadmin | 409 while any group/user has this `country` |
| POST | `/countries/:id/regions` | superadmin | `{ id?, name }`, appended. 409 on duplicate id |
| PATCH | `/countries/:id/regions/:regionId` | superadmin | `{ name }`. Display name only |
| DELETE | `/countries/:id/regions/:regionId` | superadmin | 409 while any group/user in that country has this `city` |

### Validation

- Omitted ids are derived from `name`: trimmed, lowercased, whitespace
  collapsed (`"Chiang Mai"` → `chiang mai`).
- Ids: lowercase letters/digits separated by single spaces, `-` or `_`. A name
  that cannot become an id (e.g. Burmese script) needs an explicit `id` → 400.
- Region ids are unique within a country (400 in a body, 409 on add).
- Dropping a region via PATCH `regions` is refused (409) while it is in use.

Group/user `country` / `city` writes are **not** validated against this list
yet. They are still free text.

**Deploy step:** `npx ts-node scripts/seed-countries.ts --apply` seeds 7 countries
in this order: Myanmar (9 regions), Thailand (6), Singapore (1), Vietnam (5),
Malaysia (5), Japan (6), Australia (6). The seeder is idempotent and never deletes.
Run it without `--apply` first for a dry run.
