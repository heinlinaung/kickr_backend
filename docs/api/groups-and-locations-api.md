# Groups & Locations API — Flutter Integration Guide

**Audience:** Flutter developers integrating the KickR mobile app.
**Base URL (local):** `http://localhost:3000`
**Swagger UI:** `http://localhost:3000/api-docs` · **OpenAPI JSON:** `/api-docs-json`
**Status:** implemented and verified end-to-end against Cognito + MongoDB Atlas + ImageKit. Last updated **2026-08-03** — ⚠️ includes a **breaking change to join-by-code/QR** (§3.6), plus `userRole` on group detail, `country`/`city`, uncapped team rules, and open QR access.
**See also:** [Auth API](./auth-api.md) — login, refresh, and how to obtain the access token these endpoints require.

---

## 1. Conventions you must handle

### 1.1 Every response is wrapped in `data`

A global interceptor wraps all success responses:

```json
{ "data": { "...": "the actual payload" } }
```

So always unwrap:

```dart
final body = jsonDecode(res.body) as Map<String, dynamic>;
final payload = body['data'];
```

### 1.2 Errors are NOT wrapped

Errors come back flat, and `message` is **either a string or a list of strings** (validation errors are a list). Handle both or you will crash on a 400.

```json
{
  "statusCode": 400,
  "timestamp": "2026-07-30T10:02:09.480Z",
  "path": "/groups",
  "message": ["property locationName should not exist"],
  "error": "Bad Request"
}
```

```dart
String errorText(Map<String, dynamic> body) {
  final m = body['message'];
  if (m is List) return m.join('\n');
  return m?.toString() ?? 'Unknown error';
}
```

### 1.3 Auth: send the Cognito **access token**

All endpoints below require `Authorization: Bearer <accessToken>`.

- Get tokens from `POST /auth/login` with **`{ "email", "password" }`** (sign-in is by **email**, not username).
- Use the **`accessToken`**, not the `idToken`. The backend rejects id tokens (`token_use` must be `access`) → `401`.
- On `401`, refresh via `POST /auth/refresh` and retry once.

### 1.4 IDs are Mongo ObjectId strings

24-char hex, e.g. `6a6b21217d15afe5f7856043`. Sending anything else to an `:id` route returns `400`/`404`.

### 1.5 Strip `__v`

Documents include Mongoose's `__v`. Ignore it in your models.

---

## 2. Locations

A **Location** is a place (pitch/venue). Important semantics:

- **Two kinds of location**, distinguished by `groupId`:
  - **Personal** (`groupId: null`) — only `createdBy` can edit or delete it.
  - **Group-owned** (`groupId` set) — the group's **owner / admin / captain / vice-captain** can edit it, and **owner / admin** can delete it, regardless of who created it. The creator always keeps access too.
  Locations created through `POST /groups/:id/locations` are automatically group-owned.
- **Not a shared registry, and NOT deduplicated.** Every `POST /locations` inserts a new row. If two users add the same pitch you get two rows — this is intentional. Do not build UI that assumes venues are unique/global.
- **Reusable by its owner.** One location can be attached to several of that user's own groups/events.
- `geo` is derived server-side from `lat`/`lng` — **never send `geo`**; it will be rejected.

### 2.1 Location object

```json
{
  "_id": "6a6b21227d15afe5f7856045",
  "name": "Pitch C",
  "lat": 1.5,
  "lng": 2.5,
  "url": "https://maps.google.com/?q=1.5,2.5",
  "metadata": { "surface": "grass", "indoor": false, "pitches": 2 },
  "createdBy": "6a66ff6775eaff06079c36dd",
  "groupId": null,
  "geo": { "type": "Point", "coordinates": [2.5, 1.5] },
  "createdAt": "2026-07-30T10:02:10.368Z",
  "updatedAt": "2026-07-30T10:02:10.368Z"
}
```

> ⚠️ **`geo.coordinates` is `[lng, lat]`** (GeoJSON order), the reverse of the `lat`/`lng` fields. Read `lat`/`lng` for display; treat `geo` as server-internal (it powers proximity search).

### 2.2 Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/locations` | Create. Always inserts. `createdBy` = caller. Pass `groupId` to make it group-owned (owner/admin of that group only); omit it for a personal location. |
| `GET` | `/locations` | Locations the caller **created**, newest first. Note: group-owned locations you can edit but didn't create are **not** listed here — use `GET /groups/:id/locations`. |
| `GET` | `/locations/:id` | Any location by id. |
| `PATCH` | `/locations/:id` | Creator, **or** owner/admin/**captain**/**vice-captain** of the owning group → `403` otherwise. |
| `DELETE` | `/locations/:id` | Creator, **or** owner/**admin** of the owning group (**not captain or vice-captain**) → `403` otherwise. |

#### Who can do what

| Actor | Personal location | Group-owned location |
|---|---|---|
| Creator | edit ✅ delete ✅ | edit ✅ delete ✅ |
| Group **owner** / **admin** | ❌ | edit ✅ delete ✅ |
| Group **captain** / **vice-captain** | ❌ | edit ✅ **delete ❌** |
| Plain member / non-member | ❌ | ❌ |

Captains and vice-captains can correct a venue's details but not remove it — removing a pitch the group relies on is a structural change reserved for owner/admin.

> Attaching *your personal* location to a group does **not** hand that group's staff edit rights over it. Only locations created in a group context (or otherwise carrying that `groupId`) are group-managed. This stops one user's rename from leaking into another user's groups.

**Create request** — `name`, `lat`, `lng` required; `url`, `metadata`, `groupId` optional:

```json
{
  "name": "Shwe Pitch",
  "lat": 13.7563,
  "lng": 100.5018,
  "url": "https://maps.google.com/?q=13.7563,100.5018",
  "metadata": { "surface": "grass", "pitches": 2 },
  "groupId": "6a6b21217d15afe5f7856043"
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | ✅ | ≥ 2 chars |
| `lat` | ✅ | −90…90 |
| `lng` | ✅ | −180…180 |
| `url` | — | must be a valid URL |
| `metadata` | — | free-form object |
| **`groupId`** | **—** | **Omit for a personal location.** Set it to make the location **group-owned**, so the group's owner/admin/captain/vice-captain can maintain it (see the matrix above). |

**About `groupId`:**
- **Omitted / `null`** → personal location, editable only by you.
- **Set** → group-owned. You must be an **owner or admin of that group**, otherwise `403 Only a group owner or admin can create a location owned by that group`. (Captains can *edit* group locations but can't *create* one owned by the group.)
- Sending an unknown field such as `geo` is rejected with `400 property geo should not exist` — `geo` is always derived server-side.

> Creating with `groupId` does **not** attach the location to the group's `locations` list — it only sets ownership. To also attach it, either use `POST /groups/:id/locations` (which creates *and* attaches, and is usually what you want), or create it here and then attach by id.
>
> If the group doesn't exist yet (the create-group screen), omit `groupId` entirely — see §2.3.

**Updating `lat`/`lng` refreshes `geo` automatically** — no extra call needed.

`metadata` is for **place attributes only** (surface, indoor, parking, pitch count, notes). Do **not** put relationship data there (e.g. which group uses it) — that lives on the group/event.

### 2.3 Workflow: creating a location *before* the group exists

This is the normal mobile "Create Group" screen: the user picks a venue while filling in the form, but the group has no id yet, so you **cannot** send `groupId` on the location.

**You don't need to.** Create the location plainly, then pass its id in `locationIds` when you create the group — the backend transfers ownership to the new group automatically.

```
1. POST /locations           { name, lat, lng }              -> { _id, groupId: null }   // personal
2. POST /groups              { name, ..., locationIds: [_id] } -> { _id, locations: [...] }
   └── the server stamps groupId on those locations for you
3. (optional) GET /locations/:id                             -> { groupId: "<new group id>" }
```

```dart
// 1 — venue picked on the form; no group id exists yet, so no groupId
final loc = await api.createLocation(
  name: 'Shwe Pitch', lat: 13.7563, lng: 100.5018,
); // loc.groupId == null

// 2 — creating the group adopts it
final group = await api.createGroup(
  name: 'Bangkok FC',
  handle: 'bangkok-fc',
  locationIds: [loc.id],
);
// the location is now group-owned: owner/admin/captain/vice-captain can edit it
```

**What the server does on step 2** — for each id in `locationIds`:

| Location state | Result |
|---|---|
| Personal (`groupId: null`) **and** created by you | **Adopted** — `groupId` set to the new group |
| Already owned by another group | **Skipped** — ownership is never reassigned/stolen |
| Created by a different user | Rejected up front (`403`) — you can only attach your own |

The same adoption happens on `POST /groups/:id/locations` when you attach one of your still-personal locations to an existing group.

> **Why it matters:** without this, a location created before its group would stay personal forever, and the group's admins/captains couldn't fix its name or pin — only the original creator could.

**Three ways to end up with a group-owned location**, pick whichever fits the screen:

| Situation | Call |
|---|---|
| Group doesn't exist yet (create-group form) | `POST /locations` → `POST /groups { locationIds }` ← *this section* |
| Group exists, adding a venue | `POST /groups/:id/locations { location: {...} }` (creates **and** attaches — simplest) |
| Group exists, you already know the group id | `POST /locations { ..., groupId }`, then attach if needed |

---

## 3. Groups

### 3.1 Group object

```json
{
  "_id": "6a6b21217d15afe5f7856043",
  "name": "Bangkok FC",
  "description": "test group",
  "handle": "bangkok-fc",
  "sportType": "football",
  "ownerId": "6a66ff6775eaff06079c36dd",
  "logo": "https://ik.imagekit.io/kickr/groups/...-logo-...",
  "logoFileId": "6a6b21375c7cd75eb84a157d",
  "wallpaper": "https://ik.imagekit.io/kickr/groups/...-wallpaper-...",
  "wallpaperFileId": "...",
  "rules": "No late\nBring bib\nRespect",
  "country": "Thailand",
  "city": "Bangkok",
  "locations": ["6a6b21077d15afe5f7856042", "6a6b21227d15afe5f7856045"],
  "isPrivate": false,
  "maxPlayers": 22,
  "inviteCode": "3cf16a95-8276-4bce-a989-f38941a8a5f6",
  "inviteCodeExpiry": "2026-07-31T10:07:12.395Z",
  "createdAt": "...",
  "updatedAt": "..."
}
```

`GET /groups/:id` additionally returns the **caller's own membership** (see §3.4):

```json
{ "userRole": "captain", "memberStatus": "approved" }
```

**Four field notes that bite:**

1. **`logo` vs `wallpaper`** — `logo` is the team crest (small, circular in the UI); `wallpaper` is the cover/banner photo. Both are full ImageKit CDN URLs, ready to pass straight to `Image.network`. The `*FileId` fields are for server-side replace/delete — ignore them in the app.
2. **`locations` on the group object is a list of ID strings, NOT objects.** To render names/coords, call `GET /groups/:id/locations`, which returns them **populated**. Don't try to read `.name` off the group's `locations`.
3. **`rules` entries may contain newlines and are unlimited in count and length.** See §3.9 — this needs specific handling or long rules render as one run-on paragraph.
4. **`country` / `city` are optional free text** and may be absent on older groups. They describe where the *team* is based (not a pitch), and drive the `GET /events?region=` filter.

### 3.2 Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/groups` | member | Caller's groups; each item includes **`userRole`**. Only approved memberships, so no `memberStatus`. |
| `POST` | `/groups` | any | Creator becomes `owner`. Accepts `rules`, `country`, `city`. |
| `GET` | `/groups/search?q=` | any | Public groups only (`isPrivate: false`), matches name **or** handle, max 20. |
| `GET` | `/groups/:id` | any | Group detail **+ `userRole` / `memberStatus`** for the caller. |
| `PATCH` | `/groups/:id` | owner/admin | Update name, description, maxPlayers, sportType, handle, rules, isPrivate, **country, city**. |
| `POST` | `/groups/:id/logo` | owner/admin | multipart → ImageKit. |
| `POST` | `/groups/:id/wallpaper` | owner/admin | multipart → ImageKit. |
| `GET` | `/groups/:id/qr` | **any authenticated user** | Stable invite code + link (see §3.5). **No longer owner/admin only.** |
| `GET` | `/groups/:id/invite-code` | owner/admin | **Rotates** the code (see §3.5). |
| `GET` / `POST` | `/groups/:id/locations` | any / owner-admin | List (populated) / attach, **max 5**. |
| `DELETE` | `/groups/:id/locations/:locationId` | owner/admin | Detach only — does **not** delete the location. |
| `GET` | `/groups/:id/members` | any | Members with populated `userId`. |
| `PATCH` | `/groups/:id/members/:userId/role` | owner/admin | Set `role` and/or `level`. |
| `POST` | `/groups/:id/leave` | any member | **Caller leaves the group.** Any role except `owner` (see §3.10). |
| `DELETE` | `/groups/:id/members/:userId` | owner/admin | Remove member (owner can't be removed). |
| `POST` | `/groups/:id/invitations` | any | Request to join → `pending`. |
| `GET` | `/groups/:id/invitations` | owner/admin | Pending requests. |
| `PATCH` | `/groups/:id/invitations/:invId` | owner/admin | `{ "action": "approved" \| "rejected" }`. |
| `POST` | `/groups/join-by-code` | any | `{ "code": "<inviteCode>" }` → **`pending`, requires approval** (see §3.6). ⚠️ **Changed** — no longer auto-approves. |

### 3.3 Creating a group

```json
{
  "name": "Bangkok FC",
  "description": "A group for Bangkok football players",
  "sportType": "football",
  "handle": "bangkok-fc",
  "maxPlayers": 22,
  "isPrivate": false,
  "country": "Thailand",
  "city": "Bangkok",
  "rules": "Be on time\nNo alcohol before the match",
  "locationIds": ["6a6b21077d15afe5f7856042"]
}
```

Validation rules to enforce **client-side** so users get instant feedback:

| Field | Rule | Server error if broken |
|---|---|---|
| `name` | ≥ 2 chars, required | `name must be longer than or equal to 2 characters` |
| `handle` | lowercase letters/digits/`.`/`-`/`_` only, **unique** | `handle must be lowercase alphanumeric, dot, dash or underscore` / `409` on duplicate |
| `sportType` | one of `football`, `futsal`, `padel`, `basketball` | `sportType must be one of the following values: ...` |
| `locationIds` | max 5, each a valid ObjectId **owned by the caller** | `400` / `403` if not yours |
| `rules` | any number of strings, any length | only non-string entries are rejected |
| `country`, `city` | optional free text | — |

> **Removed fields:** `locationName`, `latitude`, `longitude` no longer exist. Sending them returns `400 property locationName should not exist` (strict whitelist). Use `locationIds` / the locations endpoints instead.

### 3.4 Roles & member levels

`GET /groups/:id/members` returns:

```json
{
  "_id": "6a6b21217d15afe5f7856044",
  "groupId": "6a6b21217d15afe5f7856043",
  "userId": { "_id": "...", "name": "heinlinaung.dev", "email": "..." },
  "role": "owner",
  "level": 1,
  "status": "approved",
  "joinedAt": "2026-07-30T10:02:09.384Z"
}
```

- `role`: `owner` | `admin` | `captain` | `vice-captain` | `member`
- `level`: `1` | `2` | `3` — seniority within the group (default `1`; `3` is highest)
- `status`: `pending` | `approved` — **only `approved` members are returned by this endpoint**; pending ones come from `GET /groups/:id/invitations`.
- `userId` is **populated** here (an object), unlike most other refs.

**Changing a role/level** — `PATCH /groups/:id/members/:userId/role`:

```json
{ "role": "captain", "level": 3 }
```

Both optional, but send at least one (`400` otherwise). Constraints:
- `role` may be `admin` | `captain` | `vice-captain` | `member` — **`owner` is not assignable** (`400`). A group has exactly one owner, and changing it needs an ownership-transfer flow that does not exist yet.

  `vice-captain` carries the **same permissions as `captain`**: it can edit a group-owned location, but not delete one. Neither is an event organizer — that stays the event's creator plus the group's owner/admin.
- **The owner cannot be modified** at all → `403 Cannot change the group owner`.

> ⚠️ Path has two ids: `:id` is the **group**, `:userId` is the **target member**. The requester is taken from the token.

**`level` is currently inert.** It is stored and settable, but **nothing in the backend reads it** — no capability depends on it, and the "plus one" guest-invite feature it was designed for does not exist (§8). Show it if you like, but don't gate any UI on it yet; the semantics may still change.

#### The caller's own role — `GET /groups/:id`

Group detail includes the caller's membership, so you don't need a second call to decide what to render:

```json
{ "userRole": "captain", "memberStatus": "approved" }
```

| `userRole` | `memberStatus` | Meaning |
|---|---|---|
| `"owner"` / `"admin"` / `"captain"` / `"vice-captain"` / `"member"` | `"approved"` | A real member — gate admin UI on `userRole`. |
| `"member"` | `"pending"` | **Requested to join, NOT yet a member.** Show the waiting state. |
| `null` | `null` | Not a member at all — show Join / Request. |

> ⚠️ **You must check `memberStatus`, not just `userRole`.** A pending requester already has `userRole: "member"`, so treating a non-null role as "is a member" will show group content to someone who was never approved, and every member-only call will `403`.

### 3.5 Group QR / invite link

```
GET /groups/:id/qr
```
```json
{
  "inviteCode": "6fea5bcb-04b6-4cd4-8226-bf17905df822",
  "inviteLink": "http://localhost:3000/g/6fea5bcb-04b6-4cd4-8226-bf17905df822",
  "expiresAt": "2026-07-31T10:02:11.489Z"
}
```

- **Any authenticated user can call this now** — it is no longer owner/admin only, so you can show a "Share / Invite" affordance to ordinary members. (Safe because join-by-code requires approval, §3.6 — the code is not a bearer token for entry.)
- **The code is stable.** Calling this repeatedly returns the *same* code while it's valid, so a screenshotted or printed QR keeps working. Render the QR from `inviteLink`.
- `expiresAt` is when it stops working (24 h from minting) — show it, and re-fetch after expiry.
- **`GET /groups/:id/invite-code` ROTATES the code**, immediately invalidating any previously shared QR. It is still **owner/admin only**. Call it only from an explicit "Regenerate invite" action, never on screen load.

### 3.6 Joining a group

> ⚠️ **BREAKING CHANGE (2026-08-03).** Join-by-code/QR used to join immediately. **It now creates a pending request that an owner/admin must approve**, exactly like request-to-join. If your build still navigates the user into the group after a successful `join-by-code`, they will land in a group they are not yet a member of — every member-only call will then `403`.

Both paths now behave identically — **both end in `pending`**:

1. **Request to join** — `POST /groups/:id/invitations`. Use after finding a group via `GET /groups/search`.
2. **Join by code/QR** — `POST /groups/join-by-code` with `{ "code": "..." }`.

`join-by-code` returns:

```json
{
  "data": {
    "message": "Join request sent. Waiting for approval.",
    "groupId": "6a6b21217d15afe5f7856043",
    "status": "pending"
  }
}
```

**Branch on `status`, not on the message string** — the wording may change, the field will not.

**What the UI must do after either call:** show a "request sent — waiting for approval" state. Do **not** route into the group. The user becomes a real member only once an owner/admin calls `PATCH /groups/:id/invitations/:invId` with `{"action":"approved"}`.

**Detecting approval:** poll `GET /groups/:id` and check `memberStatus` (§3.4) — `pending` → still waiting, `approved` → let them in. There are **no push notifications for this yet** (see §8), so the requester gets no signal unless you poll or they refresh.

**Capacity is checked at approval, not at request time.** A request against a full group still succeeds with `pending`; the `400 Group is full` surfaces to the *approver* instead. So a successful join-by-code is **not** a guarantee of a free slot.

**Errors unchanged:** `400` invalid/expired code · `409` already a member or a request is already pending.

### 3.7 Attaching locations to a group

`POST /groups/:id/locations` accepts **either** an existing location **or** a new one inline:

```json
{ "locationId": "6a6b21077d15afe5f7856042" }
```
```json
{ "location": { "name": "Pitch C", "lat": 1.5, "lng": 2.5 } }
```

- Sending neither → `400 Provide either locationId or location`.
- Max **5** per group → `400 A group may have at most 5 locations`.
- With `locationId`, **you must be the creator of that location** → `403`/`404` otherwise. (Attaching is stricter than editing: group staff can edit a group-owned location, but you can only attach rows you created.)
- The **inline form is preferred** — it creates the location already owned by the group, so the group's owner/admin/captain/vice-captain can maintain it later.
- `GET /groups/:id/locations` returns them **populated** (full objects) — use this for display.
- `DELETE /groups/:id/locations/:locationId` **detaches only**; the location row survives for the owner's other groups/events.

### 3.8 Image upload (logo / wallpaper)

`multipart/form-data`, field name **`file`**. Images only: **JPEG, PNG, WebP**, max **10 MB** (`400` otherwise). Uploads go to ImageKit; the response is the updated group with a CDN URL.

```dart
Future<Map<String, dynamic>> uploadGroupLogo({
  required String groupId,
  required String accessToken,
  required File image,
}) async {
  final req = http.MultipartRequest(
    'POST',
    Uri.parse('$baseUrl/groups/$groupId/logo'),
  )
    ..headers['Authorization'] = 'Bearer $accessToken'
    ..files.add(await http.MultipartFile.fromPath('file', image.path));

  final res = await http.Response.fromStream(await req.send());
  final body = jsonDecode(res.body) as Map<String, dynamic>;
  if (res.statusCode >= 400) throw Exception(errorText(body));
  return body['data'] as Map<String, dynamic>; // updated group
}
```

Uploading again replaces the previous image (the old file is cleaned up server-side). Omitting the file → `400 File is required`.

### 3.9 Team rules — multi-line text, no limits

**There are no dedicated rules endpoints.** `rules` is an ordinary group field:

| Operation | Call |
|---|---|
| Read | `GET /groups/:id` → `rules` (also on `GET /groups`) |
| Set on create | `POST /groups` with `rules` |
| Update | `PATCH /groups/:id` with `rules` (owner/admin) |

```json
{ "rules": "No smoking\nArrive 15-30 min early\n(tell the captain if late)" }
```

> `GET`/`POST /groups/:id/rules` **existed briefly and have been removed.** Use the group field instead — a call to those paths now falls through to the `:id` wildcard and will not behave as expected.

> ### ⚠️ `rules` is now a **string**, not an array
>
> It was `string[]` (one entry per rule) and is now a single block of free-form
> text. A build doing `List<String>.from(j['rules'])` **crashes**; one rendering
> `rules.join('\n')` silently shows nothing.
>
> Existing groups were migrated by joining their entries with `\n`
> (`scripts/migrate-group-rules-to-text.ts`), so the text you get back has one
> rule per line for any group created before the change.

**`rules` REPLACES the whole value** — it does not append. To add a rule, send the existing text plus the new line, or you will wipe what was there.

Three properties to rely on:

- **No length cap worth worrying about** — 5000 characters.
- **Newlines are preserved verbatim**, including blank lines (`\n\n`). Non-ASCII (Burmese, emoji) round-trips byte-for-byte.
- **Nothing is trimmed**, so leading/trailing newlines survive too.

> **Rendering is the client's job.** HTML collapses newlines by default — render
> with `white-space: pre-line`, or split on `\n` and lay the lines out yourself.
> This is the most likely place for the feature to look broken while the API is
> behaving correctly.

> ⚠️ **You must render with `white-space: pre-line` — or the equivalent.** Flutter's `Text` already honours `\n`, but if you render rules into HTML (a `WebView`, or any web build) newlines **collapse** and a carefully formatted rule list appears as one run-on paragraph. This is the single most likely place for this feature to look broken while the API is behaving correctly. The server stores exactly what you send.

Structure it as **one array entry per rule** (matching the bulleted design) rather than one big newline-delimited string — then you can render bullets without parsing, and newlines inside an entry handle wrapped sub-clauses.

Since there is no cap, the array is an unbounded write surface: consider a sane client-side limit on your own edit screen.

### 3.10 Leaving a group

```
POST /groups/:id/leave
```
→ `200`
```json
{ "data": { "message": "You have left the group" } }
```

Self-service — **no role check**. An `admin`, `captain`, `vice-captain` or `member` can leave without anyone's approval; the membership row is deleted outright.

| Case | Status | Message |
|---|---|---|
| Left successfully | `200` | `You have left the group` |
| Caller is the **owner** | `403` | `The group owner cannot leave the group. Transfer ownership or delete the group instead.` |
| Caller is not a member | `404` | `You are not a member of this group` |
| Group does not exist | `404` | `Group not found` |

**The owner cannot leave.** A group with no owner would have nobody able to manage it, and ownership transfer does not exist yet (§8). Hide or disable the Leave action for the owner rather than letting them hit the `403`.

**Leaving also withdraws a pending join request.** A `pending` row is deleted the same way, so this doubles as "cancel my request" — no separate endpoint needed. Because `memberStatus` (§3.4) tells you which state the caller is in, you can label the same button "Leave group" or "Cancel request" accordingly.

**Rejoining** goes through the normal flow (§3.6): request to join, or use an invite code — and it needs owner/admin approval again. Leaving is not reversible by the user alone.

> Distinct from `DELETE /groups/:id/members/:userId`, which is an owner/admin **removing someone else**. This endpoint takes no target id — the caller is always the subject, so it cannot be used to remove another member.

---

## 4. Dart models

```dart
class KickrLocation {
  final String id;
  final String name;
  final double lat;
  final double lng;
  final String? url;
  final Map<String, dynamic> metadata;
  final String createdBy;
  /// Owning group, or null for a personal location.
  final String? groupId;

  KickrLocation({
    required this.id,
    required this.name,
    required this.lat,
    required this.lng,
    required this.createdBy,
    this.groupId,
    this.url,
    this.metadata = const {},
  });

  factory KickrLocation.fromJson(Map<String, dynamic> j) => KickrLocation(
        id: j['_id'] as String,
        name: j['name'] as String,
        lat: (j['lat'] as num).toDouble(),
        lng: (j['lng'] as num).toDouble(),
        url: j['url'] as String?,
        metadata: (j['metadata'] as Map<String, dynamic>?) ?? const {},
        createdBy: j['createdBy'] as String,
        groupId: j['groupId'] as String?,
      );

  bool get isGroupOwned => groupId != null;

  /// Mirrors the server rule — use it to show/hide the Edit button.
  /// [myRoleInGroup] is the caller's role in [groupId] (null if not a member).
  bool canEdit(String userId, {String? myRoleInGroup}) =>
      createdBy == userId ||
      (isGroupOwned &&
          const ['owner', 'admin', 'captain', 'vice-captain']
              .contains(myRoleInGroup));

  /// Same, minus captain/vice-captain — deleting is owner/admin only.
  bool canDelete(String userId, {String? myRoleInGroup}) =>
      createdBy == userId ||
      (isGroupOwned && const ['owner', 'admin'].contains(myRoleInGroup));

  Map<String, dynamic> toCreateJson() => {
        'name': name,
        'lat': lat,
        'lng': lng,
        if (url != null) 'url': url,
        if (metadata.isNotEmpty) 'metadata': metadata,
        // optional: makes the location group-owned so the group's
        // owner/admin/captain/vice-captain can maintain it. You must be an owner/admin of
        // that group. Omit for a personal location.
        if (groupId != null) 'groupId': groupId,
        // never send `geo` — the server derives it
      };
}

class Group {
  final String id;
  final String name;
  final String? description;
  final String? handle;
  final String? sportType;
  final String ownerId;
  final String? logo;        // ImageKit URL — team crest
  final String? wallpaper;   // ImageKit URL — cover photo
  final String rules;
  final List<String> locationIds; // IDs only; fetch /groups/:id/locations to populate
  final String? country;     // optional, e.g. 'Thailand'
  final String? city;        // optional, e.g. 'Bangkok'
  final bool isPrivate;
  final int maxPlayers;
  final String? userRole;    // caller's role — on GET /groups AND GET /groups/:id
  final String? memberStatus;// 'pending' | 'approved' — GET /groups/:id only

  Group({
    required this.id,
    required this.name,
    required this.ownerId,
    required this.isPrivate,
    required this.maxPlayers,
    this.description,
    this.handle,
    this.sportType,
    this.logo,
    this.wallpaper,
    this.rules = '',
    this.locationIds = const [],
    this.country,
    this.city,
    this.userRole,
    this.memberStatus,
  });

  /// A pending requester also has userRole == 'member', so never infer
  /// membership from the role alone — check memberStatus.
  ///
  /// GET /groups only ever returns approved memberships and omits
  /// memberStatus, so a null status with a non-null role counts as a member.
  bool get isMember =>
      memberStatus == 'approved' || (memberStatus == null && userRole != null);
  bool get isPendingApproval => memberStatus == 'pending';
  bool get canManage =>
      isMember && (userRole == 'owner' || userRole == 'admin');

  factory Group.fromJson(Map<String, dynamic> j) => Group(
        id: j['_id'] as String,
        name: j['name'] as String,
        description: j['description'] as String?,
        handle: j['handle'] as String?,
        sportType: j['sportType'] as String?,
        ownerId: j['ownerId'] as String,
        logo: j['logo'] as String?,
        wallpaper: j['wallpaper'] as String?,
        // rules is a STRING now (was List<String>) — see the callout above.
        rules: (j['rules'] as String?) ?? '',
        locationIds: List<String>.from((j['locations'] as List?) ?? const []),
        isPrivate: (j['isPrivate'] as bool?) ?? false,
        maxPlayers: (j['maxPlayers'] as num?)?.toInt() ?? 22,
        country: j['country'] as String?,
        city: j['city'] as String?,
        userRole: j['userRole'] as String?,
        memberStatus: j['memberStatus'] as String?,
      );
}

class GroupMember {
  final String id;
  final String userId;
  final String userName;
  final String role;   // owner | admin | captain | vice-captain | member
  final int level;     // 1..3
  final String status; // pending | approved

  GroupMember({
    required this.id,
    required this.userId,
    required this.userName,
    required this.role,
    required this.level,
    required this.status,
  });

  factory GroupMember.fromJson(Map<String, dynamic> j) {
    final u = j['userId'];
    return GroupMember(
      id: j['_id'] as String,
      // userId is populated on /members, a plain string elsewhere
      userId: u is Map<String, dynamic> ? u['_id'] as String : u as String,
      userName: u is Map<String, dynamic> ? (u['name'] as String? ?? '') : '',
      role: j['role'] as String,
      level: (j['level'] as num?)?.toInt() ?? 1,
      status: j['status'] as String,
    );
  }
}

class GroupInvite {
  final String inviteCode;
  final String inviteLink;
  final DateTime? expiresAt;

  GroupInvite({required this.inviteCode, required this.inviteLink, this.expiresAt});

  factory GroupInvite.fromJson(Map<String, dynamic> j) => GroupInvite(
        inviteCode: j['inviteCode'] as String,
        inviteLink: j['inviteLink'] as String,
        expiresAt: j['expiresAt'] == null
            ? null
            : DateTime.parse(j['expiresAt'] as String),
      );

  bool get isExpired =>
      expiresAt != null && DateTime.now().isAfter(expiresAt!);
}
```

---

## 5. Status codes

| Code | When | UI suggestion |
|---|---|---|
| `200` / `201` | Success | — |
| `400` | Validation failure; `message` is a **list** | Show field errors inline |
| `401` | Missing/expired/wrong-type token (id token instead of access) | Refresh once, else re-login |
| `403` | Not owner/admin; not the location owner; tried to change the group owner | Hide/disable the action instead |
| `404` | Bad or unknown id | "Not found" state |
| `409` | Duplicate — e.g. `handle` already taken | Ask for a different handle |

---

## 6. Suggested screen → endpoint map

| Screen | Calls |
|---|---|
| My groups | `GET /groups` (use `userRole` to gate admin UI) |
| Group discovery / search | `GET /groups/search?q=` |
| Create group | `POST /locations` (no `groupId` — group doesn't exist yet) → `POST /groups` with `locationIds`; the server adopts them (§2.3) |
| Group detail — header | `GET /groups/:id` (`logo`, `wallpaper`, `handle`, `country`/`city`; gate admin UI on `userRole` **+ `memberStatus == 'approved'`**) |
| Group detail — Members tab | `GET /groups/:id/members` |
| Group detail — rules | `GET /groups/:id` → `rules` (render `\n` — §3.9) |
| Group detail — map/venues | `GET /groups/:id/locations` (populated) |
| Group settings — images | `POST /groups/:id/logo`, `POST /groups/:id/wallpaper` |
| Group settings — rules | `PATCH /groups/:id` with `rules` — a **string**, replaced wholesale (§3.9) |
| Group settings — venues | `POST` / `DELETE /groups/:id/locations[/:locationId]` (max 5) |
| Invite / share QR | `GET /groups/:id/qr` → render `inviteLink`; "Regenerate" → `GET /groups/:id/invite-code` |
| Join via QR scan | `POST /groups/join-by-code` → **`pending`**; show "awaiting approval", then poll `GET /groups/:id` → `memberStatus` |
| Pending requests | `GET /groups/:id/invitations` → `PATCH .../:invId` |
| Group settings — leave | `POST /groups/:id/leave` (hide for `userRole == 'owner'`) |
| My saved venues | `GET /locations` |

---

## 7. Gotchas checklist

- [ ] Unwrap `data` on success; errors are **flat** with `message` possibly a **list**.
- [ ] Send the **accessToken** (not idToken) — sign in with **email**, not username.
- [ ] `geo.coordinates` is `[lng, lat]`; display from `lat`/`lng`. Never send `geo`.
- [ ] `group.locations` = **ID strings**; use `GET /groups/:id/locations` for objects.
- [ ] `logo` ≠ `wallpaper` (crest vs cover). Both are ready-to-use CDN URLs.
- [ ] `GET /:id/qr` is **stable** and open to **any authenticated user**; `GET /:id/invite-code` **rotates** and stays owner/admin — don't call it on screen load.
- [ ] Max **5** locations per group. Team rules have **no limit** — render with `white-space: pre-line` so newlines survive (§3.9).
- [ ] `rules` is a **string** (was an array) and `PATCH /groups/:id` **replaces** it wholesale — resend the existing text when adding a line. There are **no** `/groups/:id/rules` routes.
- [ ] **Join-by-code/QR now needs approval** (§3.6). Don't route into the group on success; branch on `status: "pending"`.
- [ ] On `GET /groups/:id`, check **`memberStatus == 'approved'`**, not just a non-null `userRole` — a pending requester has `userRole: "member"`.
- [ ] `group.level` is **inert** — nothing reads it server-side; don't gate features on it.
- [ ] Locations are **not deduplicated** — the same pitch may exist many times, once per creator.
- [ ] Check `location.groupId` before showing Edit/Delete: personal = creator only; group-owned = owner/admin/captain/vice-captain edit, owner/admin delete.
- [ ] `groupId` is **optional on create** — omit for personal, set it (as group owner/admin) for group-owned. It sets ownership only; it does **not** attach the location to the group.
- [ ] Creating a location **before** its group? Omit `groupId` and pass the id in `locationIds` on `POST /groups` — the server transfers ownership (§2.3). A location already owned by another group is skipped, never stolen.
- [ ] You can only **attach** locations you created; editing extends to group staff for group-owned rows.
- [ ] `handle` must be lowercase-slug and is globally unique (`409`).
- [ ] Owner's role/level can never be changed (`403`); `owner` isn't an assignable role.
- [ ] `POST /groups/:id/leave` is self-service for every role **except owner** — hide the action for owners (§3.10). It also cancels a pending join request.
- [ ] Uploads: field name `file`, images only (JPEG/PNG/WebP), ≤ 10 MB.

---

## 8. Not built yet — do not design against these

| Item | Status |
|---|---|
| Group **posts** feed and **gallery** | Not implemented (fields/routes absent) |
| **Ownership transfer** | Not implemented — which is why the owner cannot leave a group (§3.10). Only a full group delete would free them, and that isn't built either. |
| "Plus one" guest invites | Not implemented — approval semantics still an open product decision |
| Nearby/geo search (`GET /events?near=`) | Data is in place (`geo` + 2dsphere index) but **no endpoint yet**. `GET /events?region=` (filter by the group's `country`/`city`) **is** available. |
| `GET /locations/search?q=&near=` | **Not implemented** — list via `GET /locations` or `GET /groups/:id/locations`. |
| Notifications for join requests/approvals | **Not implemented** — the requester and the owner get no push/in-app signal. Poll `GET /groups/:id` → `memberStatus` (§3.6). |
| `role` on the **User** profile, `favouriteTeam` | Not implemented |
| Auto-generated `username` | Not implemented (`username` is `null`). `name` **can** now be set at signup — see [auth-api §3.1](./auth-api.md). |

Events currently accept a `locationId` on create but there is no endpoint to change an event's location afterwards.
