# Admin API — Integration Guide

**Audience:** back-office / support tooling and scripts. **Not the Flutter app.**
**Base URL (local):** `http://localhost:3000`
**Swagger UI:** `http://localhost:3000/api-docs` (tag **Admin**)
**Status:** force-join implemented 2026-08-03; test-data seeding (§9) added 2026-08-09.
**See also:** [groups-and-locations-api.md](./groups-and-locations-api.md) for the normal, user-facing join flow.

Two unrelated groups of endpoints share the `x-admin-key` guard:

| § | Endpoints | Purpose |
|---|---|---|
| §2–§7 | `POST /admin/groups/:id/members`, `POST /admin/events/:id/players` | Force-add users, bypassing permissions |
| §9 | `/admin/test-data` (POST, GET, DELETE) | Seed a throwaway fixture and assert behaviour against it |

---

## 0. Read this first

1. **These endpoints do not use a user JWT.** They authenticate with a shared secret in the **`x-admin-key`** header. There is no acting user, so `Authorization: Bearer` is ignored here.
2. **They are disabled by default.** If `ADMIN_KEY` is unset or blank in the server env, every request is rejected with `403` — they fail closed rather than becoming public.
3. **`ADMIN_KEY` is a root-level credential.** Anyone holding it can add any user to any group or event. Never ship it in a mobile app, a web bundle, or anything client-side.
4. **Partial success is normal.** A request returns `200` even when every id was skipped. Always read the per-user breakdown; never treat `200` as "all added".
5. Success bodies are wrapped in **`data`** and errors are **flat**, same as the rest of the API.
6. **§9 writes real data, including real Cognito identities.** Do not point it at production.

> **Do not call these from the Flutter app.** Embedding the key in a distributed binary hands every user unrestricted membership control. Put them behind your own server-side admin tool.

---

## 1. Authentication

```
x-admin-key: <ADMIN_KEY>
```

| Situation | Status | Body `message` |
|---|---|---|
| Correct key | `200` | — |
| Header missing or empty | `401` | `Missing admin key` |
| Header present but wrong | `403` | `Invalid admin key` |
| `ADMIN_KEY` unset/blank on the server | `403` | `Admin endpoints are disabled` |

The comparison is constant-time, so a wrong key can't be recovered from response timing. A wrong key of a *different length* also returns `403` (not `500`).

Server setup — in `.env`:

```
ADMIN_KEY=<long random value>
```

Ships blank in `.env.example`. Leave it blank in any environment that shouldn't expose these routes.

---

## 2. Endpoints

| Method | Path | Body | Effect |
|---|---|---|---|
| `POST` | `/admin/groups/:groupId/members` | `{ "userIds": [...] }` | Adds users as **approved** members, skipping owner approval |
| `POST` | `/admin/events/:eventId/players` | `{ "userIds": [...] }` | Adds users as **joined** players, ignoring the event's lifecycle state |

Test-data endpoints are documented separately in **§9**:

| Method | Path | Effect |
|---|---|---|
| `POST` | `/admin/test-data` | Seed a fixture and assert behaviour against it |
| `GET` | `/admin/test-data` | Recent runs |
| `GET` | `/admin/test-data/:testId` | Everything one run created |
| `DELETE` | `/admin/test-data/:testId` | Delete it all, Cognito identities included |

### Request

```json
{ "userIds": ["665f1a2b3c4d5e6f7a8b9c0d", "665f1a2b3c4d5e6f7a8b9c0e"] }
```

| Field | Rule |
|---|---|
| `userIds` | Required, non-empty array of Mongo ObjectId strings, **max 100** per call |

Duplicate ids in one request are **deduplicated** before processing, so the same user is never added twice or double-counted.

---

## 3. What is bypassed, and what is not

These endpoints skip **permissions**, not **data integrity**. The distinction matters: overfilling an event would corrupt the derived "is full" state and break team shuffling downstream.

**Bypassed:**
- Owner/admin role checks — no membership required to add anyone.
- The pending → approved approval flow (§3.6 of the groups guide). Members land **approved** immediately.
- The event's lifecycle state. You can add a player to an event in `done`, which the normal `POST /events/:id/join` would reject.

**Still enforced:**
- The group/event must exist → **`404`**.
- Each `userId` must resolve to a real user → that id is **skipped**, not fatal.
- No duplicate membership — an existing member or already-joined player is **skipped**.
- **Capacity** (`maxPlayers`). Once full, remaining ids are skipped. Event adds use the same atomic increment as the normal join path, so `joinedCount` cannot drift from the real player count.

---

## 4. Response — per-user results

Every id is processed independently and reported. **`200` even when nothing was added.**

```json
{
  "data": {
    "added": ["665f1a2b3c4d5e6f7a8b9c0d", "665f1a2b3c4d5e6f7a8b9c0e"],
    "skipped": [
      { "userId": "665f1a2b3c4d5e6f7a8b9c0f", "reason": "already_a_member" },
      { "userId": "665f1a2b3c4d5e6f7a8b9c10", "reason": "user_not_found" },
      { "userId": "665f1a2b3c4d5e6f7a8b9c11", "reason": "group_full" }
    ],
    "addedCount": 2,
    "skippedCount": 3
  }
}
```

### Reason codes

| Reason | Endpoint | Meaning |
|---|---|---|
| `already_a_member` | groups | Already a member **or** has a pending request |
| `already_joined` | events | Already an active player |
| `user_not_found` | both | No user with that id |
| `group_full` | groups | `maxPlayers` reached |
| `event_full` | events | `maxPlayers` reached |

**The operation is not atomic.** Some users can be added while others are skipped — there is no rollback. It *is* **idempotent**: re-running the same call adds nobody new (everyone already added comes back as `already_a_member` / `already_joined`), so retrying after a partial failure is safe.

Because capacity is consumed in order, a batch larger than the remaining space adds the **first** N ids and skips the rest as full. Send ids in priority order if that matters.

---

## 5. Status codes

| Code | Meaning | Handling |
|---|---|---|
| `200` | Processed — **check `added` / `skipped`** | Never assume everything was added |
| `400` | Validation: empty array, > 100 ids, malformed ObjectId | Show `message` (may be a list) |
| `401` | `x-admin-key` missing | Fix the header |
| `403` | Wrong key, **or** `ADMIN_KEY` unset server-side | Check the env config |
| `404` | Unknown group/event | Verify the id |

---

## 6. Examples

Add three users to a group:

```bash
curl -X POST http://localhost:3000/admin/groups/6a6b21217d15afe5f7856043/members \
  -H "x-admin-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userIds":["665f1a2b3c4d5e6f7a8b9c0d","665f1a2b3c4d5e6f7a8b9c0e"]}'
```

Backfill an event's players:

```bash
curl -X POST http://localhost:3000/admin/events/6a6b3f117d15afe5f7856099/players \
  -H "x-admin-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userIds":["665f1a2b3c4d5e6f7a8b9c0d"]}'
```

Node, with the partial-result handling these endpoints require:

```js
async function adminAddGroupMembers(groupId, userIds) {
  const res = await fetch(
    `${BASE_URL}/admin/groups/${groupId}/members`,
    {
      method: 'POST',
      headers: {
        'x-admin-key': process.env.ADMIN_KEY,   // server-side only
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userIds }),
    },
  );

  const body = await res.json();
  if (!res.ok) {
    const m = body.message;
    throw new Error(Array.isArray(m) ? m.join('\n') : m);
  }

  const { added, skipped } = body.data;
  // 200 does NOT mean everyone was added — report the skips.
  if (skipped.length) {
    for (const s of skipped) console.warn(`skipped ${s.userId}: ${s.reason}`);
  }
  return { added, skipped };
}
```

---

## 7. Checklist — force-join

- [ ] Send **`x-admin-key`**, not a bearer token.
- [ ] Keep `ADMIN_KEY` server-side only — never in the mobile app or a web bundle.
- [ ] Leave `ADMIN_KEY` blank wherever these routes shouldn't exist.
- [ ] Treat `200` as "processed", **not** "all added" — always read `skipped`.
- [ ] Expect partial success; retries are safe (idempotent).
- [ ] Cap batches at **100** ids; dedupe is handled server-side.
- [ ] Send ids in priority order — capacity is consumed first-come.
- [ ] Remember group adds land **approved** (no approval step) and event adds **ignore lifecycle state**.

---

## 8. Force-join scope

Everything above (§1–§7) concerns the two force-add endpoints only. The
test-data endpoints below share the same guard but behave differently: they
create data through the **normal** services, so permissions and lifecycle
gates apply — that is the point of them.

---

## 9. Test data — seed a fixture and assert behaviour

Builds a throwaway but realistic dataset and checks the API behaves correctly
around it. Intended for manual verification on a dev or staging database.

> ⚠️ **This creates real users in your Cognito pool** — 22 of them per full
> run — plus real groups, locations and events in Mongo. **Never point it at
> production.** Cleanup (§9.5) removes both stores, but a failed Cognito
> delete leaves an identity whose email blocks a re-run with the same prefix.

### 9.1 What a run creates

| Mode | Creates | Checks |
|---|---|---|
| `full` (default) | 22 users, 1 group, 3 locations, 1 event, 2 teams | Group/location permissions **and** the whole event lifecycle |
| `partial` | 22 users, 1 group, 3 locations | Group and location permissions only |

The 22 users are split **1 owner, 2 captains, 3 admins, 16 members**, all
approved members of the created group. Each is created through the real signup
path, so they exist in Cognito and can log in.

### 9.2 `POST /admin/test-data`

```json
{
  "emailPrefix": "test",
  "emailPostfix": "@example.com",
  "mode": "full"
}
```

| Field | Rule |
|---|---|
| `emailPrefix` | Required. Letters, digits, `.`, `_`, `-` only (1–30 chars) |
| `emailPostfix` | Required. Must look like `@example.com` |
| `mode` | Optional, `full` (default) or `partial` |
| `password` | Optional. Must satisfy your pool's policy; a compliant value is generated if omitted |

Addresses are built as `<prefix>-<role>-<nn><postfix>`, e.g.
`test-owner-01@example.com`, `test-member-16@example.com`.

**An address that already exists is refused and logged, never reused.** Those
addresses come back in `created.rejectedExistingUsers`, and the run continues
with whoever was created — so a partly-colliding prefix yields a partial
fixture rather than a hard failure.

> If the **owner** address collides, nothing downstream can be built (the
> group, locations and event are all created *by* the owner). The run stops
> early and returns a failed `owner account available…` check. Pick a fresh
> prefix.

### 9.3 Response

```json
{
  "data": {
    "testId": "3f2a8c14-...",
    "mode": "full",
    "created": {
      "users": 22,
      "rejectedExistingUsers": [],
      "group": 1,
      "locations": 3,
      "event": 1,
      "teams": 2
    },
    "checks": [
      { "name": "created 22 users", "passed": true, "detail": "created 22, rejected 0" },
      { "name": "plain member cannot update a group location", "passed": true },
      { "name": "join is refused once status is 'before_match'", "passed": true },
      { "name": "an MVP who never joined is refused", "passed": true }
    ],
    "passed": 24,
    "failed": 0,
    "cleanup": "DELETE /admin/test-data/3f2a8c14-...",
    "note": "Seeded data is left in place for manual verification."
  }
}
```

**Read `failed`, not the status code.** A run returns `201` whether or not its
assertions passed — the request succeeded; the *checks* are the result. Any
check with `passed: false` is a genuine behavioural regression and carries a
`detail` explaining what happened instead.

### 9.4 What the 24 checks cover

| Area | Examples |
|---|---|
| Users | 22 created with the right role split; an existing address is refused |
| Group | All 22 land as approved members |
| Locations | Owner and group admin can update; a plain member is refused |
| Join/leave gating | Allowed in `join`, refused once `before_match`; double-join refused |
| Teams | 2 teams → 2 fixtures; non-joined player refused; plain member cannot submit |
| Lifecycle | Score entry refused during `preparation`; `playing → join` refused |
| After-match | MVP recorded; an MVP who never joined refused |
| Archival | Team chats archived on `done`; a `done` event cannot be edited |

### 9.5 Inspect and clean up

**Nothing is deleted automatically** — the data stays for manual inspection.

```
GET    /admin/test-data            # recent runs, newest first (max 50)
GET    /admin/test-data/:testId    # every id one run created
DELETE /admin/test-data/:testId    # delete all of it
```

Cleanup removes the events (with their fixtures, players, team chats and
likes), locations, group memberships, group, users, **and the matching Cognito
identities**. Deleting only the Mongo rows would strand pool identities whose
emails then block a re-run.

```json
{
  "data": {
    "testId": "3f2a8c14-...",
    "deleted": { "events": 1, "locations": 3, "groups": 1, "users": 22, "cognitoUsers": 22 }
  }
}
```

A Cognito delete that fails is logged and counted, not thrown — the response
gains a `warning` naming how many could not be removed. Those emails will
block re-running with the same prefix until you remove them from the pool.

Every id is recorded on a `TestRun` document **as it is created**, so a run
that fails halfway is still fully cleanable.

### 9.6 Examples

```bash
# Seed a full fixture
curl -X POST http://localhost:3000/admin/test-data \
  -H "x-admin-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"emailPrefix":"qa","emailPostfix":"@example.com","mode":"full"}'

# See what it made
curl http://localhost:3000/admin/test-data/<testId> -H "x-admin-key: $ADMIN_KEY"

# Tear it down
curl -X DELETE http://localhost:3000/admin/test-data/<testId> \
  -H "x-admin-key: $ADMIN_KEY"
```

### 9.7 Checklist — test data

- [ ] **Never run this against production.** It creates real Cognito users.
- [ ] Use a fresh `emailPrefix` per run, or expect refusals on collisions.
- [ ] Read `failed` and the `checks` array — `201` alone means nothing passed.
- [ ] Keep the `testId`; without it, cleanup means deleting rows by hand.
- [ ] Clean up when finished, or seeded users accumulate in the Cognito pool.
- [ ] A full run makes 22 Cognito signups — mind pool rate limits.

---

## 10. Not built yet

| Item | Status |
|---|---|
| Admin **remove** member/player | Not implemented — use `DELETE /groups/:id/members/:userId` as an owner/admin |
| Per-admin identity or audit trail | Not implemented — one shared key, and **actions are not attributed or logged** |
| Rate limiting on admin routes | Inherits the global throttler only |
| Capacity override (`force: true`) | Not implemented — capacity is always enforced |
| Admin endpoints for tournaments/challenges | Not implemented |
| Test data for tournaments | §9 covers groups, locations and events only |
| Scheduled cleanup of old test runs | Not implemented — `DELETE /admin/test-data/:testId` is manual |
| Configurable user counts in §9 | Fixed at 22 (1 owner / 2 captains / 3 admins / 16 members) |

> **No audit trail** is the notable gap: there is no record of who used the key or when. If you need attribution, log it in the tool that calls these endpoints.
