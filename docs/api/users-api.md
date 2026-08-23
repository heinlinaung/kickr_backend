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
| `GET` | `/users/me` | any user | The caller's own full profile. |
| `PATCH` | `/users/me` | any user | Edit own profile. |
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
Authorization: Bearer <accessToken>
```

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
  "data": [
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
  ]
}
```

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

- **An empty or whitespace-only `q` returns `[]`** without touching the
  database. It is a search, not a user directory — there is no "list all users"
  route, by design.
- `limit` defaults to `20`, clamped to **1–50**. `?limit=5000` gives 50;
  `?limit=0` gives 1.
- A non-numeric `?limit=abc` falls back to `20` rather than erroring.
- A fractional `?limit=2.7` truncates to `2`.
- Regex metacharacters are escaped: `?q=a.c` matches the literal `a.c`, not
  `abc`. A query of `.*` finds users with `.*` in their name, not everyone.
- There is **no relevance ranking and no pagination** — no `skip`/`offset`, no
  total count. You get up to `limit` matches in whatever order Mongo returns
  them. Narrow the query rather than paging.

| Code | When |
|---|---|
| `200` | Always on success, including zero matches (`[]`) |
| `401` | Missing/invalid token, or an `idToken` sent instead of an `accessToken` |

---

## 4. Not built yet

Do **not** design screens against these.

| Feature | State |
|---|---|
| **Pagination on search** | No `skip`/`offset`/total. Capped at 50 results. |
| **Relevance ranking** | None — no text index, no score. Results are unordered. |
| **Filtering search by city/sport** | Not implemented. `country`/`city`/`preferredSport` are returned but cannot be searched on. |
| **`username` auto-generation** | Specified but not implemented — `username` may be `null`. Don't rely on it as a handle. |
| **Blocking / hiding from search** | Only `profileVisibility: "private"` removes a user. There is no per-user block list. |

---

## 5. Gotchas checklist

- [ ] **Empty `q` returns `[]`, not every user.** There is no browse-all-people call.
- [ ] **`?q=@gmail.com` finds nobody**, not every Gmail user — an `@` makes it an exact-address match.
- [ ] **`email` is never in a result row.** Don't build a UI that expects to show it.
- [ ] Rows omit unset fields entirely — decode `city`, `username` etc. as nullable.
- [ ] `country`/`city` come back **lowercase**.
- [ ] `limit` is capped at **50**, and there is no pagination to reach result 51.
- [ ] `private` profiles are absent; `members` profiles **are** present.
- [ ] Search needs a token like everything else — there is no public people-search.
- [ ] Unwrap `data` on success; errors are flat and `message` may be a **list**.
