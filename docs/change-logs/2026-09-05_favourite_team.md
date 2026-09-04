# Change Log — 2026-09-05 · `favouriteTeamId` on User

**Branch:** `events-feature-spec`
**Tests:** 946 passing across 46 suites · build clean
**Verified:** unit only — mocked Mongoose, and the club collection is still
unseeded. §7.

A user can record the real-world club they support. `GET /users/me` resolves it
into a `favouriteTeam` object.

---

## 1. Shape

```json
{
  "favouriteTeamId": "68b9c1aa22bb33cc44dd0003",
  "favouriteTeam": {
    "_id": "68b9c1aa22bb33cc44dd0003",
    "name": "Arsenal",
    "sortOrder": 3
  }
}
```

`favouriteTeamId` stays a **bare id** — the same pattern as `groupId` alongside
`group` on event detail, so a client that only needs the id does not reach into
an object for it.

## 2. Why the field is renamed rather than just populated

Mongoose `populate()` replaces the value **in place**. Left alone, the response
would carry a club *object* in a field called `favouriteTeamId` — which is the
shape the request explicitly asked to avoid.

So `findById` splits it: the id back into `favouriteTeamId`, the document into
`favouriteTeam`. A test asserts `favouriteTeamId` has no `name` property, and
it fails if the split is removed.

## 3. A write path was added, because the field was otherwise unusable

The request covered the schema field and the read projection. Those alone would
have shipped a **permanently null** field:

- `favouriteTeamId` was not in `UpdateProfileDto`, and
- the global pipe runs with `forbidNonWhitelisted: true`, so
  `PATCH /users/me` would have **rejected** it with a 400.

This was raised rather than assumed, and the owner chose the validated write
path. `PATCH /users/me` now accepts `favouriteTeamId`.

## 4. The club is checked for existence, not just shape

`@IsMongoId()` proves an id is well-formed. It does not prove the club exists,
and Mongoose `ref` does not enforce it either.

Without a check, an unknown-but-valid id saves cleanly and then reads back as
`favouriteTeam: null` on **every** subsequent request — indistinguishable from
"no club set", and awkward to trace back to the write that caused it. So
`updateProfile` verifies the club exists and throws `400 Unknown
favouriteTeamId` otherwise.

The guard is `!= null`, not `!== undefined`, deliberately: an explicit `null`
is how a client **clears** the field, and there is nothing to look up for that.
Confirmed that `@IsOptional()` permits an explicit `null` (it skips validation
for both `null` and `undefined`) by running the validator directly — so
"send null to clear" is real, not assumed.

## 5. Not on the public profile

`GET /users/:id/profile` builds its response from an explicit field allowlist,
so the new field did **not** appear there automatically. That is left as-is:
the request scoped this to `/users/me`, and whether a supported club is public
is a product decision rather than a technical one.

Worth knowing the allowlist is why this was safe — adding a field to the User
schema does not widen that endpoint.

## 6. Module wiring

`GlobalFootballTeam` is registered as a **schema** in `UsersModule`, not by
importing `GlobalFootballTeamsModule`. `populate()` needs the model on the same
connection, and registering the schema avoids coupling two modules for a
read-only join. Same reasoning as `NotificationsModule` registering `User`.

This added a constructor dependency to `UsersService`, which broke **31 tests**
across two existing specs with `Nest can't resolve dependencies`. Both now
provide the model: the search spec with a bare `{}` (it never touches this
path), the service spec with an `exists` stub defaulting to "the club exists",
so the many tests patching unrelated profile fields are unaffected.

## 7. What is NOT verified

- **The club collection is still unseeded** (see the 2026-09-04 changelog), so
  no real lookup has ever succeeded. Every test mocks the join.
- **`populate()` itself is mocked.** The tests assert it is *called* with the
  right arguments and that the rename handles its output; they do not prove
  Mongoose resolves the ref against a live database. The most likely real-world
  failure is the model not being registered on the connection — which the unit
  tests cannot catch, because they inject the model directly.
- No index on `favouriteTeamId`. None is needed for this read (it is a lookup
  *by* `_id` on the club side), but a future "how many users support Arsenal"
  query would want one.

### To verify end to end

```bash
# 1. seed the clubs (see the 2026-09-04 changelog)
npx ts-node scripts/seed-global-football-teams.ts --apply

# 2. pick one
TEAM=$(curl -s "$URL/global-football-teams" -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data[0]._id')

# 3. set it
curl -s -X PATCH "$URL/users/me" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"favouriteTeamId\":\"$TEAM\"}"

# 4. confirm the join resolved
curl -s "$URL/users/me" -H "Authorization: Bearer $TOKEN" | jq '.favouriteTeam'
# expect the club object, NOT null

# 5. an unknown id must be a 400, not a silent save
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$URL/users/me" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"favouriteTeamId":"000000000000000000000000"}'
# expect 400
```

Step 4 is the one that matters: `null` there with a valid id set means
`populate()` did not resolve, i.e. the model registration is wrong — the exact
failure the unit tests cannot see.

## 8. Tests

12 new cases in `users.favourite-team.spec.ts`.

**Read (7):** the club is projected as `favouriteTeam`; `favouriteTeamId` stays
a bare id; only `name sortOrder` are populated; `null` for unset, for an absent
field (legacy rows have no key — defaults apply on write, not read), and for a
dangling reference; and — separately worth pinning — that
`select('-__v -devices')` is still applied, so adding a populate has not
displaced the projection that keeps FCM tokens off the wire.

**Write (5):** an existing club is accepted; an unknown one is a 400 **and no
write happens**; `null` clears without a lookup; an unrelated profile edit does
not pay for a club query; and the id is actually persisted.

**Verified by reverting**, twice: removing the existence check fails 1 test,
and removing the id/object split fails 1 test. Both pass again restored.
