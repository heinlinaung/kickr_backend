# Change Log — 2026-08-26

**Branch:** `events-feature-spec`
**Tests:** 712 passing across 36 suites · build clean
**Verified:** unit only — no run against a real MongoDB and no live client.
See §6.

Two items, both about who can read what:

1. Group privacy now protects a group's **contents** instead of its
   **existence** (§1–§3).
2. `GET /groups/:id/members` stopped returning member email addresses (§4).

Plus §7, which backfills three earlier features on this branch that were
never changelogged.

---

## ⚠️ Before releasing — three client-breaking changes

**No database migration.** Nothing stored changes meaning; `isPrivate` is
read in more places than before, that is all.

1. **`GET /groups/search` now returns private groups.** Branch on the
   `isPrivate` flag in each result: show a lock and a "request to join"
   action rather than navigating in, because the members and events calls
   will `403`.
2. **Search returns a reduced card.** `inviteCode` is **gone** from it, as
   are the other non-card fields. A build reading `inviteCode` off a search
   result gets `undefined`.
3. **`GET /groups/:id/members` and `GET /events/group/:groupId` can now
   `403`.** Neither ever did before for a group id you could read.

Also: **`GET /groups/:id/members` no longer returns `userId.email`.** There
is no replacement field, by design.

---

## 1. What `isPrivate` used to do

One thing. It was read in exactly one place in the entire codebase — the
search filter — and nowhere else.

So "private" meant *hidden from search*, full stop. Anyone holding a group
id could already read a private group's:

- full detail (`GET /groups/:id`)
- member list, **including every member's email**
- venues (`GET /groups/:id/locations`)
- invite code (`GET /groups/:id/qr`)
- public events (`GET /events/group/:groupId`)

Privacy guarded *existence* and left *contents* wide open. Worth stating
plainly, because the flag's name implied the opposite and any threat model
built on it was wrong.

## 2. What it does now

The inverse: existence is discoverable, contents are gated.

| | Public group | Private group |
|---|---|---|
| Appears in `GET /groups/search` | ✅ | ✅ **changed** |
| `GET /groups/:id` (detail) | anyone | anyone |
| `GET /groups/:id/members` | anyone | 🔒 **403** unless approved member |
| `GET /events/group/:groupId` | public events to non-members | 🔒 **403** unless approved member |

A non-member can **find** a private group and see that it exists, then has
to join before seeing who is in it or when it plays.

**Approval is the gate.** A pending join request is not enough — it
`403`s until `memberStatus` is `approved`. This matches how a public
group's individually-private events already behaved, so there is one rule
for "can this caller see group-internal data", not two.

## 3. Three decisions inside that

### 3.1 `403`, not an empty list

The caller just found this group in search, so its existence is not a
secret and there is nothing to protect by pretending the schedule is
empty. `[]` would also be a lie the client renders as "no events yet",
when the truth is "join to see this". `403` lets the client show a join
prompt.

An **unknown** group is still `404`, not `403`. Existence is not what is
being protected, so there is no reason to blur the two.

### 3.2 A private group hides its *whole* schedule

The two flags interact, and the group's privacy wins: a **public** event
inside a **private** group is **not** visible to a non-member. Being able
to see that a group exists must not reveal when and where it plays.

### 3.3 Two holes that admitting private groups to search would have opened

Both closed in the same change, because both were caused by it:

- **Search had no projection at all**, so it returned `inviteCode` for
  every hit. That was already wrong for public groups; in bulk, across
  private groups, it would let anyone mass-request to join everything they
  could find. Search now returns a card, and `GET /groups/:id/qr` stays
  the one place a code is handed out — and that needs the group id
  already.
- **An empty `q` built an empty regex** that matched every group.
  Tolerable while only public groups came back; an enumeration tool once
  private ones are in scope. Empty `q` now returns `[]`, consistent with
  `/users/search` and `/events/search`.

## 4. The member email leak

`GET /groups/:id/members` populated `'name email profileImage'` behind
**no** access check of any kind. Any authenticated user could list the
members of any group and harvest their email addresses.

Now populates `'name username displayName profileImage'` — enough to
render a member row, nothing sensitive. Two regression tests pin it.

Notable because `UsersService.search` goes out of its way never to return
an email (it matches an address only in full, and never selects the
field). This was the same exposure through a different door.

**`InvitationsService.listPending` still populates email and was left
alone deliberately.** It is `assertOwnerOrAdmin`-gated, and an owner
vetting a join request has a reason to identify the requester. Different
exposure, different call — flagged here so the inconsistency is on the
record rather than discovered later.

## 5. What was deliberately not changed

`GET /groups/:id`, `/locations` and `/qr` still return a private group's
data to anyone holding the id. The decision that drove this work named
**members and events**, so that is what was gated.

The consequence, stated so it is a choice and not an oversight: a
non-member who finds a private group in search can still read its full
detail, its venue list, and its invite code. Extending the same gate to
those is a small addition — the helper already exists.

## 6. Testing

11 new tests. At the service level:

- search includes private groups, returns `isPrivate`, never returns
  `inviteCode`/`inviteCodeExpiry`, and returns `[]` for an empty query
  without touching the database
- `listMembers` `403`s a non-member and a pending member of a private
  group, allows an approved member, leaves a **public** group open, and
  `404`s an unknown group rather than `403`
- `listByGroup` `403`s a non-member of a private group **before querying
  events at all**, shows an approved member everything, and still `404`s
  an unknown group
- the member projection excludes `email` and includes `name`

**Not verified:** no live MongoDB run and no client exercised against it.
The `403`-vs-`[]` choice in particular changes what an existing screen
renders, and has only been checked at the unit level.

## 7. Backfill — earlier work on this branch with no changelog

Found while writing this. Three features shipped without an entry; listed
here with their real dates rather than folded into today's.

| Date | Change | Docs |
|---|---|---|
| 2026-08-23 | **`GET /users/search`** and **`GET /events/search`** — free-text search. Users match name/username/displayName, or an **exact** email that is never returned. Events match title/description, public only. | [users-api §3](../api/users-api.md), [events-api §5.3](../api/events-api.md) |
| 2026-08-23 | **Cursor pagination on both search endpoints.** Keyset, not `skip`. Response became `{ items, nextCursor, hasMore }` — an object, not an array. Events sort `{date, _id}`; users needed a stable `_id` sort added before a cursor could mean anything. | same |
| 2026-08-24 | **`POST /auth/change-password`** — the first authenticated route on the auth controller. Requires `currentPassword`, takes the account from the token so it cannot be aimed elsewhere. **A `401` here means "wrong current password", not "expired session"** — clients must exempt it from the refresh-and-retry interceptor. | [auth-api §6.2](../api/auth-api.md) |

Two of those carry client-breaking shapes (the page envelope, and the
`401` semantics) that were documented in the API docs at the time but
never surfaced in a changelog. Flagging in case a release note was built
from this folder.

## 8. Files

| File | Change |
|---|---|
| `src/groups/groups.service.ts` | Search projection + private groups + empty-query guard; `assertCanSeeGroupContents`; `listMembers` gate and projection |
| `src/groups/groups.controller.ts` | `listMembers` takes the caller; Swagger note |
| `src/events/events.service.ts` | `listByGroup` reads `isPrivate` and `403`s a non-member |
| `src/groups/groups.service.spec.ts` | Search + gate + projection tests |
| `src/groups/groups.controller.spec.ts` | Caller is passed through |
| `src/events/events.service.lifecycle.spec.ts` | Private-group event gating |
| `docs/api/groups-and-locations-api.md` | New §3.4b, status codes, gotchas, screen map, member response |
| `docs/api/events-api.md` | `403` banner on §5.2 |
| `docs/api/README.md` | Breaking-changes entry |
| `docs/change-logs/new-update.md` | Checklist items closed out |
