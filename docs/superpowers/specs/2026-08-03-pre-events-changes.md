# Pre-Events Change Set — Signup, Groups, Admin Endpoints

**Date:** 2026-08-03
**Author:** Backend team
**Parent spec:** [2026-07-28-kickr-spec-v2-changes.md](./2026-07-28-kickr-spec-v2-changes.md)
**Related:** [2026-08-03-events-feature-spec.md](./2026-08-03-events-feature-spec.md) — §7 below amends that spec
**Status:** to build — **do this before the Events feature**
**Stack:** NestJS 11 · MongoDB (Mongoose) · AWS Cognito

---

## 1. Scope

Eight changes requested ahead of the Events work. Six touch existing modules; two amend the Events spec.

| # | Change | Area | Size |
|---|---|---|---|
| 1 | Sign up with a user-supplied `name` | Auth | S |
| 2 | Group detail returns the caller's `userRole` | Groups | S |
| 3 | Group gains `country`, `city`; `teamRules` cap removed | Groups | S |
| 4 | Drop the role check on `GET /groups/:id/qr` | Groups | XS |
| 5 | Admin force-join endpoints (group + event) | New `admin` module | M |
| 6 | **Join-by-code/QR requires approval** (no auto-approve) | Invitations | S |
| 7 | Event detail returns the group's rules | Events | XS |
| 8 | `GET /events?region=` filter by group country/city | Events | S |

Items 1–6 are independent and can ship in any order. Items 7–8 are folded into the Events build.

> **§6 resolves parent spec §14 #5**, open since 2026-07-22 — the contradiction where join-by-code auto-approved while the spec said owners approve new members. It also materially narrows the risk introduced by §5 (see §5.2).

---

## 2. Signup with name

### 2.1 Current state — VERIFIED

`SignupDto` accepts only `email` + `password`. `AuthService.signup` seeds the required `name` field from the email's local part via `defaultNameFromEmail(email)`, with a comment noting users rename themselves later via `PATCH /users/me`.

### 2.2 Change

Accept an optional `name` on signup and use it when supplied:

```ts
// SignupDto — new field
@ApiProperty({ example: 'Thar Htet', required: false, minLength: 2, maxLength: 60 })
@IsOptional()
@IsString()
@MinLength(2)
@MaxLength(60)
name?: string;
```

`AuthService.signup` becomes `name: dto.name?.trim() || defaultNameFromEmail(email)`.

**Why optional rather than required — confirmed by product 2026-08-03.** Making it required is a breaking change to a shipped, client-facing endpoint. Optional keeps existing clients working while letting the new flow pass a real name. Should it become mandatory later, that is a one-line DTO change plus a coordinated client release.

`trim()` then `||` matters: a whitespace-only `name` falls back to the email-derived default instead of persisting a blank display name.

> **Note:** username autogeneration (parent §2.2) remains **unbuilt** and is out of scope here. This change only sets `name`.

---

## 3. Group detail with the caller's role

### 3.1 Current state — VERIFIED

`GET /groups/:id` → `GroupsService.findById(groupId)` returns the raw group document. It takes no `userId` and reveals nothing about the caller's relationship to the group. `GroupsService.getMemberRole(groupId, userId)` **already exists** and returns the role string or `null`.

### 3.2 Change

`GET /groups/:id` response gains:

```
userRole: 'owner' | 'admin' | 'captain' | 'member' | null
memberStatus: 'pending' | 'approved' | null
```

`null` means the caller is not a member. `memberStatus` is included because `userRole` alone is ambiguous: a pending join request already has `role: 'member'` stored, so without the status a requester awaiting approval is indistinguishable from an approved member.

Implementation: `findById(groupId, userId)` calls the existing `getMemberRole` and returns `{ ...group, userRole, memberStatus }`. The controller already has `@CurrentUser()` available on sibling routes.

**Field name:** `userRole` (camelCase), matching every other field in the API (`maxPlayers`, `inviteCode`, `teamRules`). The request wrote `userrole`; camelCase **confirmed by product 2026-08-03**.

---

## 4. Group schema — country, city, rules

### 4.1 Change — new optional fields

```
country: string   // optional, e.g. 'Myanmar', 'Thailand'
city: string      // optional, e.g. 'Yangon', 'Bangkok'
```

Both free-text and optional, added to `Group`, `CreateGroupDto` and `UpdateGroupDto`. Indexed as `{ country: 1, city: 1 }` to support the §7 region filter.

> **Reversal of an earlier decision.** Parent spec §4.2 explicitly said country/city are **not** added to Group and should be derived from the referenced `Location`. That is now overridden: a group's country/city is a property of the *team*, not of any one pitch it plays on, and §7's region filter needs it on the group directly — deriving it through `Group.locations[] → Location` for every event query is a multi-stage join for data that is one string. The parent spec should be updated to reflect this.

### 4.2 Rules — reuse `teamRules`, remove the cap

**Decision:** reuse the existing `teamRules: string[]`. The sample content (a 6-item Burmese conduct list) does not fit the shipped max-3 cap, so **the cap is removed**.

Remove in both places that enforce it:
- `SetGroupRulesDto` — drop `@ArrayMaxSize(3)`
- `GroupsService.setRules` — drop the `rules.length > 3` check and its `BadRequestException`

No per-rule length limit (explicitly decided). Also update the DTO's `description: 'max 3 rules'` and its `example`, which currently document the removed cap.

**Unbounded-array note:** with no cap and no length limit, a client can post an arbitrarily large `teamRules` array and grow the group document without bound. Accepted per explicit decision. Mongo's 16 MB document ceiling is the only backstop; if abuse becomes a concern, a generous cap (e.g. 50 rules) is an additive change requiring no migration.

### 4.3 Newline preservation — verified

Multi-line rule text **round-trips intact**. Verified empirically for both the Burmese sample and multi-line ASCII:

| Stage | Behaviour |
|---|---|
| JSON request body | Newlines arrive as the escape sequence `\n`; the body parser restores real newlines |
| `class-validator` | `@IsString()` only validates; no transform. No `@Transform`/trim on this DTO |
| Mongoose `[String]` | `teamRules` has **no `trim: true`** (unlike `Group.handle`), so nothing is stripped |
| JSON response | Re-escaped to `\n`; the client parses back to real newlines |

Interior blank lines (`\n\n`), emoji, and Burmese script are all preserved byte-for-byte.

**Two caveats for the client team:**

1. **Do not add `trim: true`** to this field. It would strip leading/trailing newlines (interior ones would survive). Called out because sibling fields on this schema do use it.
2. **Rendering is the client's job.** The API stores and returns `\n` faithfully, but HTML collapses newlines by default — the client must render with `white-space: pre-line` (or split on `\n`) or the rules will appear as one run-on paragraph. This is the most likely place for the feature to look broken while the backend is behaving correctly.

**Structure choice:** an array of strings where each entry is one rule (matching the sample's bullet structure) is preferred over one big newline-delimited string, since it lets the client render bullets without parsing. Newlines *within* an entry are still preserved for wrapped sub-clauses like the sample's parenthetical asides.

---

## 5. Group QR — remove the role check

### 5.1 Current state — VERIFIED

`GroupsService.getQr` opens with `await this.assertOwnerOrAdmin(groupId, userId)`, so only owners and admins can fetch the invite link.

### 5.2 Change

Delete that one line. Any authenticated user may call `GET /groups/:id/qr` (the `JwtAuthGuard` on the controller still applies).

`userId` stays in the signature — `getQr` passes it to `generateInviteCode(groupId, userId)` when the existing code is missing or expired, so the parameter is still load-bearing. Only the assertion is removed.

> **Security note — largely mitigated by §6b.** On its own, this change would let any logged-in user enumerate group ids, harvest invite codes, and self-join any group without approval. **Change §6b closes that hole**: a harvested code now only produces a *pending request* an owner must approve, so the code stops being a bearer token for entry.
>
> Residual exposure is the invite code and link themselves being readable by any authenticated user. That is acceptable given approval gating, but **§5 and §6b should ship together** — §5 alone, without §6b, is a genuine self-service-entry hole. If §5 ships first, expect that window.

---

## 6. Admin endpoints — force join

### 6.1 Purpose

Server-to-server/support endpoints to add users to a group or event in bulk, bypassing the normal permission and approval flow. Authenticated by a shared secret from env, **not** by a user JWT.

### 6.2 Auth — `AdminKeyGuard`

New `src/common/guards/admin-key.guard.ts`:

- Reads the `x-admin-key` request header.
- Compares against `ADMIN_KEY` from `ConfigService`.
- **401** when the header is missing, **403** when it is present but wrong.
- If `ADMIN_KEY` is unset or empty, **every request is rejected** — the endpoints fail closed rather than becoming unauthenticated when the env var is absent.
- Comparison uses `crypto.timingSafeEqual` on equal-length buffers (length-check first, since `timingSafeEqual` throws on a length mismatch). Prevents leaking the key a byte at a time via response timing.

These routes do **not** use `JwtAuthGuard` — there is no acting user. New env var, added to `.env.example`:

```
# Admin endpoints (server-to-server). Leave blank to disable them entirely.
ADMIN_KEY=
```

> **Deployment note:** `.env.example` ships blank so the endpoints are disabled by default. Setting a weak `ADMIN_KEY` grants unrestricted power to add any user to any group or event — treat it like a root credential and use a long random value.

### 6.3 Routes

New `src/admin/` module (`admin.controller.ts`, `admin.service.ts`, DTOs).

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/admin/groups/:groupId/members` | `{ userIds: string[] }` | Force-add users as approved members |
| POST | `/admin/events/:eventId/players` | `{ userIds: string[] }` | Force-add users as joined players |

`userIds`: non-empty array of Mongo ids, max 100 per call, deduplicated before processing.

### 6.4 Semantics — bypass permissions, keep data integrity

**Bypassed:** owner/admin role checks, the pending→approved approval flow, and the event's lifecycle state gate (users can be added to an event that is not in `join`).

**Still enforced:**
- The group/event must exist → **404**.
- Each user id must resolve to a real `User` → that id is skipped, not fatal.
- No duplicate membership — an existing member/player is skipped.
- **Capacity** — `maxPlayers` is respected. Once full, remaining ids are skipped with a reason rather than overfilling.

Rationale: the guard exists to skip *permission*, not to create states the rest of the system cannot handle. Overfilled events would break the derived `isFull` logic and team shuffling downstream.

### 6.5 Response — per-user results, 200 overall

Each id is processed independently; partial success is normal and the call is safely re-runnable.

```json
{
  "added":   ["665f...a1", "665f...a2"],
  "skipped": [
    { "userId": "665f...a3", "reason": "already_a_member" },
    { "userId": "665f...a4", "reason": "user_not_found" },
    { "userId": "665f...a5", "reason": "group_full" }
  ],
  "addedCount": 2,
  "skippedCount": 3
}
```

Reason codes: `already_a_member` / `already_joined`, `user_not_found`, `group_full` / `event_full`, `invalid_id`.

Returns **200** even when every id is skipped — the request itself succeeded. Only a missing group/event (404) or a bad admin key (401/403) is an error status.

**Counter integrity:** the event endpoint must `$inc` `joinedCount` per successful add using the same atomic capacity-guarded update the normal join path uses, not a blind write — otherwise `joinedCount` drifts from the real `EventPlayer` count and the derived `isFull` breaks. Reuse `EventsService`'s existing mechanism rather than duplicating it.

Group adds create `GroupMember { role: 'member', status: 'approved', joinedAt: now }`, matching what approval produces. Event adds reactivate a prior `cancelled` row rather than inserting a duplicate, matching `EventsService.join`.

---

## 6b. Join-by-code / QR requires approval

*(Numbered 6b to avoid renumbering §7–§10 cross-references; it is change #6 in the §1 table.)*

### 6b.1 Current state — VERIFIED

`InvitationsService.joinByCode` creates the membership as **already approved**:

```ts
await this.memberModel.create({
  groupId: group._id,
  userId: new Types.ObjectId(userId),
  role: 'member',
  status: 'approved',       // ← auto-approved, bypassing the owner
  joinedAt: new Date(),
});
return { message: 'Joined group successfully', groupId: group._id };
```

Meanwhile `requestToJoin` creates `status: 'pending'` and waits for an owner/admin to `PATCH /groups/:id/invitations/:invId`. The two paths disagree — this is exactly the inconsistency parent spec §14 #5 has flagged as OPEN since 2026-07-22.

### 6b.2 Change

Join-by-code becomes a **join request**, identical in outcome to `requestToJoin`:

```ts
await this.memberModel.create({
  groupId: group._id,
  userId: new Types.ObjectId(userId),
  role: 'member',
  status: 'pending',       // was 'approved'
  // joinedAt deliberately NOT set — it is stamped on approval
});
return {
  message: 'Join request sent. Waiting for approval.',
  groupId: group._id,
  status: 'pending',
};
```

Three coupled details, each of which breaks something if missed:

1. **Drop `joinedAt`.** It means "when they actually joined". `respond()` already stamps it on approval; setting it at request time would make a pending row look joined and corrupt any future join-date reporting.
2. **Change the response message.** It currently says "Joined group successfully" — leaving that while the user is only pending would tell the client the wrong thing. Adding an explicit `status: 'pending'` field lets the client branch without string-matching the message.
3. **Move the capacity check.** See §6b.3.

No change is needed to the approval side: `listPending` and `respond` filter on `status: 'pending'` and `groupId` only, with no notion of how the row got there, so code-originated requests appear in the owner's pending list automatically.

### 6b.3 Capacity check — must move, not just change

`joinByCode` currently rejects with "Group is full" at *request* time. That check has to move to approval time, and `respond()` already performs it.

Keeping it at request time would be wrong in both directions:
- A group that is full *now* may have space when the owner reviews, so a valid request is refused for no reason.
- A group with one free slot could accumulate ten pending requests, all of which pass the request-time check; only approval-time enforcement stops the eleventh member.

**Decision:** remove the capacity check from `joinByCode`. `respond()` is the single enforcement point. This also makes the code path and the request-to-join path behave identically, which is the whole point of the change.

> The duplicate-membership check (`ConflictException`) **stays** in `joinByCode` — a user shouldn't be able to stack multiple pending requests for one group, and that guard is not capacity-dependent.

### 6b.4 Consequences

| Area | Effect |
|---|---|
| **Client flow** | Scanning a QR no longer grants immediate access. The client must show a "request sent, awaiting approval" state instead of navigating into the group. **Breaking UX change — coordinate the release.** |
| **§5 QR widening** | Materially de-risked. §5 lets any authenticated user fetch any invite code, but with approval required, a harvested code now only creates a pending request an owner must accept — it no longer grants self-service entry. |
| **Parent §14 #5** | ✅ **RESOLVED** — both join paths now require approval. Update the parent spec's decision table and its §13.2 flowchart, which currently documents the auto-approve branch as intended behaviour. |
| **Invite code purpose** | The code now identifies *which group* to request, not a bearer token granting entry. Expiry still applies. |

> **Note on notifications:** neither join path currently notifies anyone — the invitations module has no `NotificationsService` dependency, so owners must poll `GET /groups/:id/invitations`. With QR joins now needing approval, un-notified requests are more likely to sit unnoticed. Adding "invitation requested/approved/rejected" triggers is already scoped in parent §12; worth pulling forward, but out of scope here.

### 6b.5 Testing

- Join-by-code creates `status: 'pending'`, with `joinedAt` unset.
- The resulting row appears in `GET /groups/:id/invitations`.
- Owner approval promotes it to `approved` and stamps `joinedAt`.
- A full group **accepts** the request (no longer 400) and rejects at approval time instead.
- Requesting twice with the same code still 409s.
- Expired/invalid code still 400s.
- Regression: the existing auto-approve assertion in any current test must be **updated, not deleted** — it now asserts the opposite outcome.

---

## 7. Amendments to the Events spec

Both items amend [2026-08-03-events-feature-spec.md](./2026-08-03-events-feature-spec.md) and should be folded into its build, not tracked separately.

### 7.1 Event detail returns the group's rules

`GET /events/:id` response gains:

```
groupRules: string[]    // the parent group's teamRules; [] for events with no groupId
```

Populated from `Group.teamRules` via the event's `groupId`. Empty array (never `null`) for public events with no group, so the client can render unconditionally.

Read-only projection — the rules live on the group and are edited through `POST /groups/:id/rules`. Fetched with a `select('teamRules')` projection rather than a full populate.

Amends the Events spec §4.4 (Event schema — no new stored field; this is a response-time join) and its §6 API surface row for `GET /events/:id`.

### 7.2 `GET /events?region=` filter

New query param filtering events by their group's location:

```
GET /events?region=Myanmar
GET /events?region=Bangkok
```

`region` matches **either** `Group.country` **or** `Group.city`, case-insensitively — so `region=Myanmar` and `region=Yangon` both work without the client having to know which granularity it holds. Depends on §4.1's new fields.

**Implementation:** resolve matching group ids, then filter events by `groupId: { $in: [...] }`. Two queries, but it keeps the existing simple `find()` path intact and composes cleanly with the other filters.

**Interaction with the `near=`/`radius=` geo filter (Events spec §4.5):** the two are independent and may be combined — `region` narrows by the *group's* stated country/city, `near` by the *event location's* coordinates. When both are present, both apply (logical AND). Note they can contradict each other (a Myanmar-registered group playing at a pitch in Thailand yields no results); that is correct behaviour, not a bug.

Events with no `groupId` are **excluded** when `region` is set — they have no group to derive a region from. Documented because it is a silent-empty-result trap otherwise.

Amends the Events spec §4.5 and its §6 API surface row for `GET /events`.

---

## 8. Build order

1. **Signup name** (§2) — self-contained, one DTO + one line of service.
2. **Group fields + rules cap** (§4) — schema, DTOs, remove cap in two places.
3. **Group detail userRole** (§3) — reuses the existing `getMemberRole`.
4. **Join-by-code approval** (§6b) — **pair with step 5**; see below.
5. **QR role check removal** (§5) — one line.
6. **Admin endpoints** (§6) — the only item needing a new module, guard, and env var.
7. **Events amendments** (§7) — build with the Events feature, not before.

**Ordering constraints:**
- **Steps 4 and 5 ship together.** §5 opens invite codes to every authenticated user; §6b is what stops that from being self-service entry. Shipping 5 before 4 leaves a real hole. If they must be split, do **4 first**.
- Step 2 must precede §7.2's region filter.
- Steps 1, 3, 6 are independent of everything else.

**Client coordination:** step 4 is a breaking UX change (QR scan no longer grants immediate entry) and needs a matching client release.

---

## 9. Testing

- **Signup** — name supplied → persisted; omitted → email-derived fallback; whitespace-only → fallback; length bounds rejected.
- **Group detail** — owner/admin/captain/member each see their role; non-member sees `null`; pending requester sees `userRole: 'member'` with `memberStatus: 'pending'`.
- **Rules** — 6-item array accepted (the previously-rejected case); **newlines and Burmese text survive a write-then-read round-trip** (the caveat most likely to regress); empty array clears.
- **QR** — a plain member and a non-member both get a payload; expired code regenerates.
- **Join-by-code approval** (§6b.5) — pending not approved; `joinedAt` unset; appears in the owner's pending list; full group accepts the request and blocks at approval.
- **Admin guard** — no header → 401; wrong key → 403; unset `ADMIN_KEY` → rejected even with a matching header.
- **Admin add** — mixed batch yields correct `added`/`skipped` split; duplicate ids deduped; capacity stop mid-batch; `joinedCount` matches the real `EventPlayer` count afterwards; re-running the same call is a no-op.
- **Region filter** — matches on country and on city; case-insensitive; groupless events excluded; combines with `near=`.

---

## 10. Decisions & flags

**Decided:**

| # | Decision |
|---|---|
| 1 | `name` on signup is **optional** — required would break shipped clients |
| 2 | Reuse `teamRules`; **remove the max-3 cap**, no per-rule length limit |
| 3 | Admin endpoints bypass permissions but **keep data integrity** (capacity, existence, duplicates) |
| 4 | Per-user results with **200 overall**; non-atomic and re-runnable |
| 5 | QR readable by **any authenticated user** |
| 6 | `country`/`city` live **on Group**, overriding parent spec §4.2 |
| 7 | Join-by-code/QR **requires owner approval** — resolves parent §14 #5 |
| 8 | Capacity for code-joins is enforced at **approval**, not request (§6b.3) |

| 9 | `name` on signup stays **optional** — confirmed 2026-08-03 |
| 10 | Response field is **`userRole`** (camelCase) — confirmed 2026-08-03 |

**Flagged for confirmation — none blocking:**

1. **Unbounded `teamRules`** (§4.2) — no cap and no length limit is an unbounded write surface; accepted by decision.
3. **`ADMIN_KEY` is a root-level credential** (§6.2) — anyone holding it can add any user to any group or event.
4. **§5 must not ship without §6b** (§8 build order) — the pairing is what keeps opened invite codes from becoming self-service entry.
5. **QR join is now a breaking UX change** (§6b.4) — needs a coordinated client release.
6. **Notifications gap** (§6b.4) — owners aren't notified of join requests, so approval-gated QR joins may sit unnoticed. Parent §12 covers it; consider pulling forward.

**Parent spec updates this change set requires:**

- §4.2 — country/city now **are** on Group (§4.1 reverses the earlier "derive from Location" decision).
- §14 #5 — mark **RESOLVED** (approval required on both paths).
- §13.2 flowchart — currently shows `join-by-code → status: approved (auto)`; that branch now goes to `pending`, merging with the request-to-join path.
- §4.5 invitations table — the "Owner approval / Fix inconsistency" row is now done.
