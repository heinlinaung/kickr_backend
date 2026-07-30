# Groups & Locations API — Flutter Integration Guide

**Audience:** Flutter developers integrating the KickR mobile app.
**Base URL (local):** `http://localhost:3000`
**Swagger UI:** `http://localhost:3000/api-docs` · **OpenAPI JSON:** `/api-docs-json`
**Status:** implemented and verified end-to-end against Cognito + MongoDB Atlas + ImageKit (2026-07-30).

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

- **Creator-owned.** `createdBy` is the owner. **Only the owner can edit or delete it.**
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
  "geo": { "type": "Point", "coordinates": [2.5, 1.5] },
  "createdAt": "2026-07-30T10:02:10.368Z",
  "updatedAt": "2026-07-30T10:02:10.368Z"
}
```

> ⚠️ **`geo.coordinates` is `[lng, lat]`** (GeoJSON order), the reverse of the `lat`/`lng` fields. Read `lat`/`lng` for display; treat `geo` as server-internal (it powers proximity search).

### 2.2 Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/locations` | Create. Always inserts. `createdBy` = caller. |
| `GET` | `/locations` | **Only the caller's own** locations, newest first. |
| `GET` | `/locations/:id` | Any location by id. |
| `PATCH` | `/locations/:id` | **Owner only** → `403` otherwise. |
| `DELETE` | `/locations/:id` | **Owner only** → `403` otherwise. |

**Create request** — `name`, `lat`, `lng` required:

```json
{
  "name": "Shwe Pitch",
  "lat": 13.7563,
  "lng": 100.5018,
  "url": "https://maps.google.com/?q=13.7563,100.5018",
  "metadata": { "surface": "grass", "pitches": 2 }
}
```

Validation: `name` ≥ 2 chars · `lat` −90…90 · `lng` −180…180 · `url` must be a valid URL · `metadata` free-form object.

**Updating `lat`/`lng` refreshes `geo` automatically** — no extra call needed.

`metadata` is for **place attributes only** (surface, indoor, parking, pitch count, notes). Do **not** put relationship data there (e.g. which group uses it) — that lives on the group/event.

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
  "teamRules": ["No late", "Bring bib", "Respect"],
  "locations": ["6a6b21077d15afe5f7856042", "6a6b21227d15afe5f7856045"],
  "isPrivate": false,
  "maxPlayers": 22,
  "inviteCode": "3cf16a95-8276-4bce-a989-f38941a8a5f6",
  "inviteCodeExpiry": "2026-07-31T10:07:12.395Z",
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Two field notes that bite:**

1. **`logo` vs `wallpaper`** — `logo` is the team crest (small, circular in the UI); `wallpaper` is the cover/banner photo. Both are full ImageKit CDN URLs, ready to pass straight to `Image.network`. The `*FileId` fields are for server-side replace/delete — ignore them in the app.
2. **`locations` on the group object is a list of ID strings, NOT objects.** To render names/coords, call `GET /groups/:id/locations`, which returns them **populated**. Don't try to read `.name` off the group's `locations`.

### 3.2 Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/groups` | member | Caller's groups; each item includes `myRole`. |
| `POST` | `/groups` | any | Creator becomes `owner`. |
| `GET` | `/groups/search?q=` | any | Public groups only (`isPrivate: false`), matches name **or** handle, max 20. |
| `GET` | `/groups/:id` | any | Group detail. |
| `PATCH` | `/groups/:id` | owner/admin | Update name, description, maxPlayers, sportType, handle, teamRules, isPrivate. |
| `POST` | `/groups/:id/logo` | owner/admin | multipart → ImageKit. |
| `POST` | `/groups/:id/wallpaper` | owner/admin | multipart → ImageKit. |
| `GET` | `/groups/:id/qr` | owner/admin | Stable invite code + link (see §3.5). |
| `GET` | `/groups/:id/invite-code` | owner/admin | **Rotates** the code (see §3.5). |
| `GET` / `POST` | `/groups/:id/rules` | any / owner-admin | Team rules, **max 3**. |
| `GET` / `POST` | `/groups/:id/locations` | any / owner-admin | List (populated) / attach, **max 5**. |
| `DELETE` | `/groups/:id/locations/:locationId` | owner/admin | Detach only — does **not** delete the location. |
| `GET` | `/groups/:id/members` | any | Members with populated `userId`. |
| `PATCH` | `/groups/:id/members/:userId/role` | owner/admin | Set `role` and/or `level`. |
| `DELETE` | `/groups/:id/members/:userId` | owner/admin | Remove member (owner can't be removed). |
| `POST` | `/groups/:id/invitations` | any | Request to join → `pending`. |
| `GET` | `/groups/:id/invitations` | owner/admin | Pending requests. |
| `PATCH` | `/groups/:id/invitations/:invId` | owner/admin | `{ "action": "approved" \| "rejected" }`. |
| `POST` | `/groups/join-by-code` | any | `{ "code": "<inviteCode>" }` — **auto-approves** (see §3.6). |

### 3.3 Creating a group

```json
{
  "name": "Bangkok FC",
  "description": "A group for Bangkok football players",
  "sportType": "football",
  "handle": "bangkok-fc",
  "maxPlayers": 22,
  "isPrivate": false,
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
| `teamRules` | max 3 strings | `rules must contain no more than 3 elements` |

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

- `role`: `owner` | `admin` | `captain` | `member`
- `level`: `1` | `2` | `3` — seniority within the group (default `1`; `3` is highest)
- `status`: `pending` | `approved` — **only `approved` members are returned by this endpoint**; pending ones come from `GET /groups/:id/invitations`.
- `userId` is **populated** here (an object), unlike most other refs.

**Changing a role/level** — `PATCH /groups/:id/members/:userId/role`:

```json
{ "role": "captain", "level": 3 }
```

Both optional, but send at least one (`400` otherwise). Constraints:
- `role` may be `admin` | `captain` | `member` — **`owner` is not assignable** (`400`).
- **The owner cannot be modified** at all → `403 Cannot change the group owner`.

> ⚠️ Path has two ids: `:id` is the **group**, `:userId` is the **target member**. The requester is taken from the token.

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

- **The code is stable.** Calling this repeatedly returns the *same* code while it's valid, so a screenshotted or printed QR keeps working. Render the QR from `inviteLink`.
- `expiresAt` is when it stops working (24 h from minting) — show it, and re-fetch after expiry.
- **`GET /groups/:id/invite-code` ROTATES the code**, immediately invalidating any previously shared QR. Only call it from an explicit "Regenerate invite" action, never on screen load.

### 3.6 Joining a group

Two paths, with **different approval behaviour** — surface this in the UI:

1. **Request to join** — `POST /groups/:id/invitations` → status `pending`, waits for owner/admin approval. Use after finding a group via `GET /groups/search`.
2. **Join by code/QR** — `POST /groups/join-by-code` with `{ "code": "..." }` → **joins immediately (auto-approved)**, no approval step.

Capacity is enforced against `maxPlayers` on approval/join.

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
- With `locationId`, **you must own that location** → `403`/`404` otherwise. The inline form creates it under the caller, so it always works.
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

  KickrLocation({
    required this.id,
    required this.name,
    required this.lat,
    required this.lng,
    required this.createdBy,
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
      );

  /// Only the owner may edit/delete.
  bool isOwnedBy(String userId) => createdBy == userId;

  Map<String, dynamic> toCreateJson() => {
        'name': name,
        'lat': lat,
        'lng': lng,
        if (url != null) 'url': url,
        if (metadata.isNotEmpty) 'metadata': metadata,
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
  final List<String> teamRules;
  final List<String> locationIds; // IDs only; fetch /groups/:id/locations to populate
  final bool isPrivate;
  final int maxPlayers;
  final String? myRole;      // present on GET /groups

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
    this.teamRules = const [],
    this.locationIds = const [],
    this.myRole,
  });

  factory Group.fromJson(Map<String, dynamic> j) => Group(
        id: j['_id'] as String,
        name: j['name'] as String,
        description: j['description'] as String?,
        handle: j['handle'] as String?,
        sportType: j['sportType'] as String?,
        ownerId: j['ownerId'] as String,
        logo: j['logo'] as String?,
        wallpaper: j['wallpaper'] as String?,
        teamRules: List<String>.from((j['teamRules'] as List?) ?? const []),
        locationIds: List<String>.from((j['locations'] as List?) ?? const []),
        isPrivate: (j['isPrivate'] as bool?) ?? false,
        maxPlayers: (j['maxPlayers'] as num?)?.toInt() ?? 22,
        myRole: j['myRole'] as String?,
      );

  bool get canManage => myRole == 'owner' || myRole == 'admin';
}

class GroupMember {
  final String id;
  final String userId;
  final String userName;
  final String role;   // owner | admin | captain | member
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
| My groups | `GET /groups` (use `myRole` to gate admin UI) |
| Group discovery / search | `GET /groups/search?q=` |
| Create group | `POST /locations` (optional) → `POST /groups` with `locationIds` |
| Group detail — header | `GET /groups/:id` (`logo`, `wallpaper`, `handle`) |
| Group detail — Members tab | `GET /groups/:id/members` |
| Group detail — rules | `GET /groups/:id/rules` |
| Group detail — map/venues | `GET /groups/:id/locations` (populated) |
| Group settings — images | `POST /groups/:id/logo`, `POST /groups/:id/wallpaper` |
| Group settings — rules | `POST /groups/:id/rules` (max 3) |
| Group settings — venues | `POST` / `DELETE /groups/:id/locations[/:locationId]` (max 5) |
| Invite / share QR | `GET /groups/:id/qr` → render `inviteLink`; "Regenerate" → `GET /groups/:id/invite-code` |
| Join via QR scan | `POST /groups/join-by-code` |
| Pending requests | `GET /groups/:id/invitations` → `PATCH .../:invId` |
| My saved venues | `GET /locations` |

---

## 7. Gotchas checklist

- [ ] Unwrap `data` on success; errors are **flat** with `message` possibly a **list**.
- [ ] Send the **accessToken** (not idToken) — sign in with **email**, not username.
- [ ] `geo.coordinates` is `[lng, lat]`; display from `lat`/`lng`. Never send `geo`.
- [ ] `group.locations` = **ID strings**; use `GET /groups/:id/locations` for objects.
- [ ] `logo` ≠ `wallpaper` (crest vs cover). Both are ready-to-use CDN URLs.
- [ ] `GET /:id/qr` is **stable**; `GET /:id/invite-code` **rotates** — don't call it on screen load.
- [ ] Max **5** locations per group, max **3** team rules.
- [ ] Locations are **not deduplicated** — the same pitch may exist many times, once per creator.
- [ ] You can only attach/edit/delete **your own** locations.
- [ ] `handle` must be lowercase-slug and is globally unique (`409`).
- [ ] Owner's role/level can never be changed (`403`); `owner` isn't an assignable role.
- [ ] Uploads: field name `file`, images only (JPEG/PNG/WebP), ≤ 10 MB.

---

## 8. Not built yet — do not design against these

| Item | Status |
|---|---|
| Group **posts** feed and **gallery** | Not implemented (fields/routes absent) |
| "Plus one" guest invites | Not implemented — approval semantics still an open product decision |
| Nearby/geo search (`GET /events?near=`) | Data is in place (`geo` + 2dsphere index) but **no endpoint yet** |
| Whether join-by-code *should* require approval | Open decision — currently auto-approves |
| `role` on the **User** profile, `favouriteTeam` | Not implemented |

Events currently accept a `locationId` on create but there is no endpoint to change an event's location afterwards.
