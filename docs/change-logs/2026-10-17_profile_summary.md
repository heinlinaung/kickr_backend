# 2026-10-17 — Profile summary counts

One call for the three numbers on a profile header: events, reviews and
groups. Works for the current user (pass your own id) or anyone else.

All responses are shown as the payload inside the standard `{ "data": … }`
envelope. Requires a JWT.

---

## `GET /users/:id/summary`

**Who:** any signed-in user.

**Response `200`**

```json
{
  "userId": "68aa02…",
  "eventCount": 7,
  "reviewCount": 4,
  "groupCount": 3
}
```

| Field | Counts |
|---|---|
| `eventCount` | Events the user is on the roster of (`status: "joined"`). Left/cancelled rows and invites don't count. Same number as `statistics.matchesPlayed` on the profile. |
| `reviewCount` | Ratings the user received as a **player** (`targetType: "player"`). Ratings they *wrote* don't count. |
| `groupCount` | Groups the user is an **approved** member of, including groups they own. Pending join requests don't count. |

**Errors:** `404` malformed id, unknown or deleted user, or someone else's
profile with `privacy.profileVisibility: "private"`. Your own private
profile still returns `200`.

**Client flow:** on your own profile screen, call it with the id from
`GET /users/me`.

## Deploy

No migration. Read-only counts over existing collections.
