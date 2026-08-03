# Admin API (Force-Join) — Integration Guide

**Audience:** back-office / support tooling and scripts. **Not the Flutter app.**
**Base URL (local):** `http://localhost:3000`
**Swagger UI:** `http://localhost:3000/api-docs` (tag **Admin**)
**Status:** implemented 2026-08-03.
**See also:** [groups-and-locations-api.md](./groups-and-locations-api.md) for the normal, user-facing join flow.

---

## 0. Read this first

1. **These endpoints do not use a user JWT.** They authenticate with a shared secret in the **`x-admin-key`** header. There is no acting user, so `Authorization: Bearer` is ignored here.
2. **They are disabled by default.** If `ADMIN_KEY` is unset or blank in the server env, every request is rejected with `403` — they fail closed rather than becoming public.
3. **`ADMIN_KEY` is a root-level credential.** Anyone holding it can add any user to any group or event. Never ship it in a mobile app, a web bundle, or anything client-side.
4. **Partial success is normal.** A request returns `200` even when every id was skipped. Always read the per-user breakdown; never treat `200` as "all added".
5. Success bodies are wrapped in **`data`** and errors are **flat**, same as the rest of the API.

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

## 7. Checklist

- [ ] Send **`x-admin-key`**, not a bearer token.
- [ ] Keep `ADMIN_KEY` server-side only — never in the mobile app or a web bundle.
- [ ] Leave `ADMIN_KEY` blank wherever these routes shouldn't exist.
- [ ] Treat `200` as "processed", **not** "all added" — always read `skipped`.
- [ ] Expect partial success; retries are safe (idempotent).
- [ ] Cap batches at **100** ids; dedupe is handled server-side.
- [ ] Send ids in priority order — capacity is consumed first-come.
- [ ] Remember group adds land **approved** (no approval step) and event adds **ignore lifecycle state**.

---

## 8. Not built yet

| Item | Status |
|---|---|
| Admin **remove** member/player | Not implemented — use `DELETE /groups/:id/members/:userId` as an owner/admin |
| Per-admin identity or audit trail | Not implemented — one shared key, and **actions are not attributed or logged** |
| Rate limiting on admin routes | Inherits the global throttler only |
| Capacity override (`force: true`) | Not implemented — capacity is always enforced |
| Admin endpoints for tournaments/challenges | Not implemented |

> **No audit trail** is the notable gap: there is no record of who used the key or when. If you need attribution, log it in the tool that calls these endpoints.
