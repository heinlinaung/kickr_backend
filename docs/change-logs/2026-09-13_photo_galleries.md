# Change Log — 2026-09-13 · Photo galleries

**Branch:** `events-feature-spec`
**Tests:** 1086 passing across 53 suites · build clean
**Verified:** unit, plus the app booted to confirm the module graph. §7.

`GET|POST|DELETE /groups/:id/photos`, backed by a new shared `photos`
collection that event photos now use too — which is what makes an event's photo
appear in its group's gallery.

---

## 1. One polymorphic collection, as specced

```
Photo { targetType, targetId, groupId, url, fileId, uploadedBy, createdAt }
```

`targetType` is `group` | `event` | `tournament`. Tournament has no routes yet;
it is listed so adding one later is a **value, not a schema change**, which was
the extensibility the spec asked for.

`targetType` + `targetId` rather than three nullable foreign keys: the pair is
always exactly one thing, so a row cannot end up half-attached to two owners.

`targetId` is deliberately **not** a Mongoose `ref` — it points at a different
collection depending on `targetType`, so a single `ref` would be wrong two times
in three and `populate()` would silently resolve against the wrong model.

## 2. How an event photo reaches the group gallery

`groupId` is denormalised onto the photo at upload time, from `event.groupId`.
The group gallery is then one indexed query:

```ts
{ $or: [{ targetType: 'group', targetId: id }, { groupId: id }] }
```

Both halves are needed. Matching `targetId` alone misses the event photos;
matching `groupId` alone misses the group's own, which carry `groupId: null`
because `targetId` already identifies the group. A test asserts both branches,
and **removing either one fails it**.

The alternative — walking the group's events and querying photos per event —
would be N+1 and would break the moment a tournament joined in. The cost of the
denormalisation is that moving an event between groups would strand its photos,
which the API does not permit: `groupId` cannot be changed by
`PATCH /events/:id`.

## 3. The 30 cap, counted before the upload

`MAX_PHOTOS_PER_TARGET = 30`, per target — 30 for a group **and** 30 for each of
its events, so an active event cannot exhaust the group's allowance.

The count happens **before** `imagekit.upload`. Uploading first would leave an
orphaned remote file on every refusal — billable, and invisible from the
database since no row would reference it. A test pins the ordering, and moving
the check after the upload fails it.

## 4. Permissions

| | Who |
|---|---|
| View the group gallery | Any **approved member** — a pending request is not enough |
| Upload / delete | Group **owner or admin** |

Viewing is deliberately wider than uploading: the point of a gallery is that
everyone in the group can look at it. Upload matches the existing event-photo
gate, so one rule covers both, per the decision on this change.

`uploadedBy` is recorded from the start even though only owners/admins can
upload today. The old embedded `EventPhoto` stored only `{url, fileId}`, so a
photo could not be attributed at all — adding the field later would leave every
existing row unattributable.

## 5. A circular dependency, found by booting

`PhotosModule` first imported `GroupsModule` for its permission helpers. That
closed a cycle:

```
GroupsModule -> EventsModule -> PhotosModule -> GroupsModule
```

**The build passed.** It failed at runtime:

```
UndefinedModuleException: Nest cannot create the PhotosModule instance.
The module at index [2] of the PhotosModule "imports" array is undefined.
```

Found only because the app was actually booted after wiring it — `nest build`
does not resolve the module graph.

Fixed by **removing** the cycle rather than papering over it with `forwardRef`:
`PhotosModule` registers the `GroupMember` **schema** and does its own
four-line membership query, the same approach `NotificationsModule` and
`UsersModule` already use for cross-module reads. That keeps it a leaf, which in
turn made the *reverse* edge safe — `GroupsModule -> PhotosModule` — for the
cascade in §6.

Trading four lines of duplicated query against a permanent structural coupling
was the right way round.

## 6. Group delete cascades photos

`DELETE /groups/:id` now removes the group's own photos, and the response counts
them alongside events/members/messages/locations.

Only the group's **own** photos: an event's went with the event via
`removeAllForGroup`, so deleting by `groupId` here would race that and
double-count. Remote files are best-effort inside the service, so a slow
ImageKit cannot fail the whole delete.

Without this they would be orphaned rows pointing at a deleted group, with their
CDN files leaked and nothing left referencing them.

## 7. What is NOT verified

- **No live database.** The two new indexes have never been built and no query
  plan checked — notably the `$or` gallery query, which is the one most likely
  to scan if the `{groupId, createdAt, _id}` index is not used.
- **No real upload.** `ImageKitService` is mocked throughout; no photo has
  actually reached the CDN through the new path.
- **The "no existing photo data" assumption.** The owner reported no events
  currently hold photos, so no migration was written. If that is wrong, those
  photos are **invisible** through the new endpoints — the field is deprecated
  but the data is still there.

  That report was not a query, so it is now one:
  `scripts/check-legacy-event-photos.ts` reports any event still holding
  embedded photos and, with `--apply`, copies them into the new collection
  (matched on `fileId`, so a re-run cannot duplicate). Worth running once before
  dropping the field — a flagged-but-unchecked assumption is exactly what turned
  into the guest-index bug on 2026-09-08.
- **`event.photos` was left on the schema**, deprecated and unwritten, rather
  than dropped — removing it is a separate cleanup once the above is confirmed.

## 8. Tests

**19 new in `photos.service.spec.ts`** — the cap boundary (30th allowed, 31st
refused), the count happening before the upload, per-target counting,
`uploadedBy` recorded, the `groupId` tag set for events and null for groups, the
gallery `$or` covering both halves, the sort tiebreaker, delete scoping, 404 on
a missing photo, a failing remote delete not failing the request, and the
membership checks including that a pending request is not membership.

**Event photo tests rewritten** from asserting a mutated array to asserting
delegation: the upload is tagged with the event *and its group*, a standalone
event passes `null`, the service no longer calls ImageKit itself, the delete is
scoped to the event, and the organizer check still runs before delegating.

**Verified by reverting, twice:** breaking the gallery `$or` fails 1 test;
moving the cap check after the upload fails 1.

**One group-delete test added** asserting the photo cascade, plus the blast-radius
assertion updated to include the new count.

## 9. Usage

```bash
URL=http://localhost:3000
TOKEN=<Cognito ACCESS token>
GROUP=6a6b2366f78b66d63a911a9e
```

### Upload to the group gallery

```bash
curl -s -X POST "$URL/groups/$GROUP/photos" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/photo.jpg;type=image/jpeg"
```

### Read the gallery — includes event photos

```bash
curl -s "$URL/groups/$GROUP/photos" -H "Authorization: Bearer $TOKEN" \
  | jq '.data.photos[] | {targetType, targetId, url}'
```

`targetType: "event"` rows came from one of the group's events.

### Upload to an event — appears in both

```bash
curl -s -X POST "$URL/events/<eventId>/photos" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/photo.jpg;type=image/jpeg"
```

Requires the event to be in `after_match`.

### Delete

```bash
# a group's own photo
curl -s -X DELETE "$URL/groups/$GROUP/photos/file_abc" \
  -H "Authorization: Bearer $TOKEN"

# an event's photo — through the EVENT route, not the group one
curl -s -X DELETE "$URL/events/<eventId>/photos/file_xyz" \
  -H "Authorization: Bearer $TOKEN"
```
