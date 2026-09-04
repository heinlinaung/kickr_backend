# Change Log — 2026-09-04 · `globalfootballteams` collection

**Branch:** `events-feature-spec`
**Tests:** 934 passing across 45 suites · build clean
**Verified:** unit only. **The seed has NOT been run** — see §6.

New reference collection of real-world football clubs, plus a read endpoint and
an idempotent seed script.

---

## 1. What was added

| File | Role |
|---|---|
| `schemas/global-football-team.schema.ts` | `{ name, sortOrder }`, collection `globalfootballteams` |
| `global-football-teams.service.ts` | `findAll()` — the whole list, in order |
| `global-football-teams.controller.ts` | `GET /global-football-teams` |
| `global-football-teams.module.ts` | Registered in `app.module.ts` |
| `scripts/seed-global-football-teams.ts` | Seeds the 20 clubs; dry-run by default |

## 2. The source `id` was dropped, as requested

The supplied list carried `id: 1..20`. That is **not** stored — Mongo's `_id`
is the identity.

Keeping both would mean two identities for one row, and the failure mode is
silent: some code references a club by `id`, some by `_id`, and they drift the
moment anything is re-inserted. A test asserts no `id` path exists on the
schema and that the seed list has no `id:` key.

`sort_order` **was** kept, as `sortOrder`, because it is real display data —
see §3.

## 3. Why `sortOrder` is its own field

The intended order is by **league standing, not alphabetical**: Manchester
United precedes Arsenal. So it cannot be derived from `name`.

Nor from `_id`: an ObjectId sorts by creation time, so reordering the list
would mean deleting and re-inserting rows — which would break anything already
referencing an id.

It is **not unique**. Two clubs sharing a position is a display quirk, not a
data error, and enforcing uniqueness would turn an intentional reshuffle into a
multi-step migration (every row between the old and new position needs moving,
and no intermediate state may collide).

`name` **is** unique, and that is load-bearing — see §4.

## 4. The seed is idempotent, and `name` is why

The script matches on `name` and upserts:

- missing club → inserted
- existing club with a different `sortOrder` → updated
- existing club, same order → untouched
- **`_id` of an existing row is never changed**, so anything referencing one
  keeps working across re-runs

The unique index on `name` is what makes this safe: a second "Arsenal" cannot
be created even if the script is run twice concurrently.

**Rows in the DB but absent from the list are reported, never deleted.** A club
could already be referenced by a user's profile, and deleting it would leave a
dangling id. Removing a genuinely defunct club is a deliberate manual step.

Dry-run by default, `--apply` to write, matching every other script in
`scripts/`. It prints its target URI with credentials redacted before doing
anything, so seeding the wrong database is visible rather than discovered
afterwards.

## 5. The endpoint is deliberately unpaginated

Every other list added recently got cursor pagination. This one did not.

It is a fixed list of about twenty clubs filling a single picker. Paginating it
would make every consumer implement a loop to render a dropdown, for a
collection that does not grow without bound. `data` is therefore a plain array
here — worth flagging, since `/notifications` now returns an envelope and a
client might reasonably expect consistency.

If it ever spans multiple leagues, the useful addition is a `?country=` or
`?league=` filter, not pages.

Read-only: no create, update or delete, because this is reference data rather
than user content. No owner field either, for the same reason.

## 6. What is NOT verified

**The seed has never been run.** The sandbox cannot reach the Atlas cluster
(DNS blocked), so:

- no document has been inserted, and the `name` unique index has never been
  built — the index is what makes the seed idempotent, so its absence would
  only show up as duplicate clubs on a second run
- the upsert branches (insert / update / unchanged) are asserted by reading the
  script, not by executing them
- `GET /global-football-teams` has never returned a non-empty array

What *was* verified: the script compiles, runs, prints its redacted target and
dry-run banner, and fails only at the connection. So the pre-connect path is
exercised; the database path is not.

### To seed it

```bash
# dry run — reports what WOULD change, writes nothing
npx ts-node scripts/seed-global-football-teams.ts

# apply
npx ts-node scripts/seed-global-football-teams.ts --apply

# confirm
curl -s "$URL/global-football-teams" -H "Authorization: Bearer $TOKEN" \
  | jq '.data | length'   # expect 20
```

Run the dry run first and check the `Target:` line names the database you
intend.

## 7. Tests

17 new cases across two specs.

**Service and schema (9):** the sort is `{sortOrder: 1, name: 1}`; the query is
unfiltered and unpaginated; the projection is `name sortOrder`; an unseeded
collection returns `[]` rather than throwing; no `id` path exists; `name` is
unique and `sortOrder` is not; and the collection name is pinned to
`globalfootballteams` — a rename there without updating the seed script would
leave the API reading an empty collection.

**The seed list itself (8):** it cannot be imported (the script connects to
Mongo on load), so the list is parsed out of the source. All 20 clubs in the
supplied order, no duplicate names, `sortOrder` 1–20 with no gaps, no `id`
key, no untrimmed whitespace, dry-run by default, no delete operation
anywhere, and credentials redacted before printing.

The whitespace and duplicate checks are not padding: `name` is both the unique
index **and** the match key, so `'Arsenal '` with a trailing space is a
*different* club to the index — the next run would insert a near-duplicate
rather than updating the existing row.

**Verified by injecting a fault:** replacing `Liverpool` with a second
`Arsenal` fails 2 of the 8 list guards. Restored, all pass.
