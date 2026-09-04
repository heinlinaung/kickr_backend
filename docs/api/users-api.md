# Users API (Search / Profile) — Flutter Integration Guide

**Audience:** Flutter developers building people-search and profile screens.
**Base URL (local):** `http://localhost:3000` · **Swagger:** `/api-docs`
**Status:** ⚠️ **Written from source, not captured from live calls** — unlike the
auth and groups docs, the payload shapes below were read off the service and its
unit tests, not recorded from a running server. Field *names* and *behaviour* are
accurate; treat the example values as illustrative and confirm against
`/api-docs` before shipping a screen.
**See also:** [Auth API](./auth-api.md) for the tokens these routes require.

---

## 1. Conventions

Both conventions from the other docs apply:

1. **Success responses are wrapped in `data`**; error responses are **flat**, and
   `message` may be a string **or a list of strings**.
2. **Send the Cognito `accessToken`** as `Authorization: Bearer …`. The `idToken`
   is rejected with `401`.

Every route here requires a token — `UsersController` is guarded wholesale, so
there is no anonymous people-search.

---

## 2. Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/users/search?q=` | any user | **NEW** — find people by name/username/displayName, or by an **exact** email. See §3. |
| `GET` | `/users/me` | any user | The caller's own full profile, incl. the resolved **`favouriteTeam`** (§4). |
| `PATCH` | `/users/me` | any user | Edit own profile, incl. **`favouriteTeamId`** (§4). |
| `POST` | `/users/me/avatar` | any user | Avatar upload (multipart `file`). |
| `GET` | `/users/me/qr` | any user | The caller's invite code / link. |
| `GET` | `/users/:id/profile` | any user | Another user's public profile. `404` when `privacy.profileVisibility: "private"`. |

> Only `/users/search` is documented in detail below — the rest are listed so the
> table is a complete picture of the controller. They predate this doc and are
> covered by Swagger.

---

## 3. `GET /users/search` — find people

```http
GET /users/search?q=hein
GET /users/search?q=hein@example.com
GET /users/search?q=hein&limit=50
GET /users/search?q=hein&limit=20&cursor=eyJpIjoi…
Authorization: Bearer <accessToken>
```

Returns a **page object** — `{ items, nextCursor, hasMore }` — not a bare array.
See §3.5 for paging.

Case-insensitive **substring** match on `name`, `username` and `displayName`.
Not a prefix or whole-word match: `?q=ein` finds `hein`.

### 3.1 Email is matched only in full, and never returned

An email clause is added **only when `q` contains `@`**, and then it matches the
address **exactly** — never as a substring.

This is deliberate, and it is the one behaviour to understand before building the
search UI:

- `?q=hein@example.com` → matches that one account.
- `?q=@gmail.com` → matches **nobody**. It contains `@`, so it is treated as a
  full address to match exactly, and no user's address *is* the literal string
  `@gmail.com`. It does **not** enumerate every Gmail user.
- The address is lowercased before matching, since emails are stored lowercase —
  `?q=Hein@Example.COM` works.

**The `email` field is never present in a result row.** Even an exact hit tells
you only that the account exists. So a result set can never be mined for
addresses the caller did not already know.

### 3.2 What a result row contains

A display card, and nothing more:

```json
{
  "data": {
    "items": [
      {
        "_id": "6a6cce80419acf83c69c01a7",
        "name": "Hein Lin Aung",
        "username": "heinla",
        "displayName": "Hein",
        "profileImage": "https://ik.imagekit.io/…/profiles/….jpg",
        "country": "myanmar",
        "city": "yangon",
        "preferredSport": "football"
      }
    ],
    "nextCursor": "eyJpIjoiNmE2Y2NlODA0MTlhY2Y4M2M2OWMwMWE3In0",
    "hasMore": true
  }
}
```

> ⚠️ **The payload is a page object, not an array.** `data.items` holds the rows;
> `data.nextCursor` and `data.hasMore` drive paging. A build doing
> `List.from(json['data'])` breaks — read `json['data']['items']`.

Fields are selected at the database level, so `email`, `phoneNumber`,
`cognitoSub`, `dateOfBirth` and the whole `privacy` block are **never loaded** —
they cannot leak even if the response shaping changes later.

Absent fields are simply missing from the row rather than `null`, so decode
defensively: a user who never set a `city` has no `city` key.

> `country` and `city` are stored **lowercase**. Capitalise for display; do not
> round-trip them into a filter expecting the original casing.

### 3.3 Private profiles are excluded

Users with `privacy.profileVisibility: "private"` never appear. Listing them
would advertise accounts that `GET /users/:id/profile` answers `404` for, so
every row you get back is a profile you can actually open.

The enum is `public | members | private`, and **only `private` is excluded** — a
`members` user *does* appear in results, because the profile route currently
treats `members` as public too. If that is ever scoped to shared groups, search
will need the same change to stay consistent.

A user who has never touched privacy settings has no stored value and defaults to
public, so they are included.

### 3.4 Empty query, limits and edge cases

- **An empty or whitespace-only `q` returns an empty page** (`items: []`,
  `hasMore: false`) without touching the database. It is a search, not a user
  directory — there is no "list all users" route, by design.
- `limit` defaults to `20`, clamped to **1–50**. `?limit=5000` gives 50;
  `?limit=0` gives 1.
- A non-numeric `?limit=abc` falls back to `20` rather than erroring.
- A fractional `?limit=2.7` truncates to `2`.
- Regex metacharacters are escaped: `?q=a.c` matches the literal `a.c`, not
  `abc`. A query of `.*` finds users with `.*` in their name, not everyone.
- There is **no relevance ranking** — no text index, no score. Rows come back in
  `_id` order, which is insertion order: arbitrary as a ranking, but *stable*,
  which is what makes the cursor safe.
- There is **no total count**. `hasMore` tells you whether another page exists;
  nothing tells you how many rows match overall.

| Code | When |
|---|---|
| `200` | Always on success, including zero matches (`items: []`) |
| `400` | Malformed or forged `cursor` — start again without one |
| `401` | Missing/invalid token, or an `idToken` sent instead of an `accessToken` |

### 3.5 Paging with `cursor`

Pagination is **cursor-based (keyset)**, not `page`/`offset`. Fetch the first
page with no `cursor`, then feed `nextCursor` back verbatim:

```http
GET /users/search?q=hein&limit=20
→ { "data": { "items": [...20], "nextCursor": "eyJpIjoi…", "hasMore": true } }

GET /users/search?q=hein&limit=20&cursor=eyJpIjoi…
→ { "data": { "items": [...7],  "nextCursor": null,      "hasMore": false } }
```

- **Stop when `hasMore` is `false`.** `nextCursor` is `null` at that point, so
  looping on `nextCursor != null` works equally well. Do not keep requesting.
- **`limit` is a page size, not a result cap.** Capped at 50 *per page*; page
  with `cursor` to read past 50 in total.
- **The cursor is opaque.** It is base64url JSON today, and that is an
  implementation detail — do not parse, build, or edit it. Round-trip it
  unchanged. A malformed or hand-crafted value is a `400`.
- **`limit` may change between pages** without breaking the cursor; the cursor
  encodes a position, not a page number.
- Why keyset and not `skip`: `skip` re-scans every preceding row (so deep pages
  get slower) and shifts when rows are inserted or deleted mid-scroll, which
  silently repeats or skips users. A cursor says "everything after this exact
  row", so it stays correct under concurrent writes.

> **A cursor is not a snapshot.** Rows created after you started paging can still
> appear on a later page, and a user who is renamed out of the query, deleted, or
> switched to `private` mid-scroll simply won't show up. You will never see the
> *same* user twice, which is the guarantee `skip` cannot make.

---

## 4. Favourite team

*(New 2026-09-05.)*

A user can record the real-world club they support. The list to choose from is
[`GET /global-football-teams`](./global-football-teams-api.md).

### Reading it — `GET /users/me`

The stored id is resolved into a **`favouriteTeam`** object, so a profile screen
renders the club without a second request:

```json
{
  "data": {
    "_id": "507f191e810c19729de860e1",
    "name": "Hein",
    "favouriteTeamId": "68b9c1aa22bb33cc44dd0003",
    "favouriteTeam": {
      "_id": "68b9c1aa22bb33cc44dd0003",
      "name": "Arsenal",
      "sortOrder": 3
    }
  }
}
```

- **`favouriteTeamId` stays a bare id**, not an object — same pattern as
  `groupId` alongside `group` on event detail.
- **`favouriteTeam` is `null`** when no club is set, when the field predates
  this feature, or when the stored id points at a club that has since been
  removed. A client cannot tell those apart and does not need to; a dangling
  reference never fails the request.
- Only `_id`, `name` and `sortOrder` are included — the rest of the club
  document is timestamps.

> ⚠️ **Not on the public profile.** `GET /users/:id/profile` does not include
> this. It uses a strict field allowlist, so surfacing a club there is a
> deliberate change, not something that happened automatically.

### Setting it — `PATCH /users/me`

```json
{ "favouriteTeamId": "68b9c1aa22bb33cc44dd0003" }
```

**The club must exist.** An id that is well-formed but unknown is a **400**
(`"Unknown favouriteTeamId"`), not a silent save — otherwise it would read
back as `favouriteTeam: null` forever, indistinguishable from "not set" and
hard to trace to the write that caused it.

Send `null` to clear it:

```json
{ "favouriteTeamId": null }
```

```bash
# set
curl -s -X PATCH "$URL/users/me" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"favouriteTeamId":"68b9c1aa22bb33cc44dd0003"}'

# clear
curl -s -X PATCH "$URL/users/me" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"favouriteTeamId":null}'
```

**Store the id, never the name.** A club can be renamed — the seed script
updates rows in place — and a stored name would silently go stale while an id
stays correct.

## 5. Not built yet

Do **not** design screens against these.

| Feature | State |
|---|---|
| **Offset pagination / total count** | Deliberately absent — pagination is cursor-based (§3.5) and there is no `skip`, `page` or total. |
| **Relevance ranking** | None — no text index, no score. Ordered by `_id`. |
| **Filtering search by city/sport** | Not implemented. `country`/`city`/`preferredSport` are returned but cannot be searched on. |
| **`username` auto-generation** | Specified but not implemented — `username` may be `null`. Don't rely on it as a handle. |
| **Blocking / hiding from search** | Only `profileVisibility: "private"` removes a user. There is no per-user block list. |

---

## 6. Gotchas checklist

- [ ] **`favouriteTeam` is resolved on `GET /users/me` only** — not on the public profile (§4).
- [ ] **Persist `favouriteTeamId`, never the club name.** Clubs get renamed; ids do not.
- [ ] **`favouriteTeam: null` is ambiguous by design** — unset, legacy, or a deleted club. Do not treat it as an error.
- [ ] **An unknown `favouriteTeamId` on PATCH is a 400**, not a silent save.
- [ ] **Empty `q` returns an empty page, not every user.** There is no browse-all-people call.
- [ ] **`?q=@gmail.com` finds nobody**, not every Gmail user — an `@` makes it an exact-address match.
- [ ] **`email` is never in a result row.** Don't build a UI that expects to show it.
- [ ] Rows omit unset fields entirely — decode `city`, `username` etc. as nullable.
- [ ] `country`/`city` come back **lowercase**.
- [ ] `limit` is a **page size** capped at 50, not a result cap — page with `cursor` to go past it.
- [ ] **The response is an object, not an array.** Read `items`; `data` wraps the whole page.
- [ ] `private` profiles are absent; `members` profiles **are** present.
- [ ] Search needs a token like everything else — there is no public people-search.
- [ ] Unwrap `data` on success; errors are flat and `message` may be a **list**.
