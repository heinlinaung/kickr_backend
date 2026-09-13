# Photos API (for the Flutter app)

Photo galleries for groups and events, stored in one shared collection so an
event's photos also appear in its group's gallery.

> ⚠️ Written from source, not captured live.

---

## 1. The shape

| Route | Who |
|---|---|
| `GET /groups/:id/photos` | Any approved **member** |
| `POST /groups/:id/photos` | Group **owner/admin** |
| `DELETE /groups/:id/photos/:fileId` | Group **owner/admin** |
| `GET /events/:id/photos` *(via event detail)* | — |
| `POST /events/:id/photos` | Event **organizer** |
| `DELETE /events/:id/photos/:fileId` | Event **organizer** |

**The group gallery includes its events' photos.** Upload to an event and it
appears under `GET /groups/:id/photos` as well — one row, two places, nothing to
keep in sync.

## 2. `GET /groups/:id/photos`

```bash
curl -s "$URL/groups/6a6b2366f78b66d63a911a9e/photos" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": {
    "photos": [
      {
        "_id": "68b9f1aa22bb33cc44dd0001",
        "targetType": "event",
        "targetId": "507f1f77bcf86cd799439011",
        "groupId": "6a6b2366f78b66d63a911a9e",
        "url": "https://ik.imagekit.io/kickr/events/photos/abc.jpg",
        "fileId": "file_abc",
        "uploadedBy": "507f191e810c19729de860e1",
        "createdAt": "2026-09-13T10:00:00.000Z"
      }
    ]
  }
}
```

Newest first. **Read `targetType` to tell them apart**: `group` is a photo
uploaded straight to the gallery, `event` came from one of the group's events
and `targetId` is that event's id — useful for a "from Friday's match" caption
or a deep link.

**Members only.** A non-member gets `403`, and a pending join request counts as
a non-member — the same gate as the member list and chat history.

## 3. `POST /groups/:id/photos`

Multipart, field name **`file`**. JPEG/PNG/WebP, 10 MB max.

```bash
curl -s -X POST "$URL/groups/6a6b2366f78b66d63a911a9e/photos" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/photo.jpg;type=image/jpeg"
```

Returns the group's **own** photos (not the union), newest first.

**Owner/admin only** — `403` otherwise, matching who may upload an event photo.

## 4. The 30-photo cap

**At most 30 photos per target.** A group may hold 30 of its own, and *each* of
its events may hold 30 more — the cap is per target, not per gallery, so an
active event cannot exhaust the group's allowance.

Exceeding it is a `400`:

```json
{
  "statusCode": 400,
  "message": "This group already has the maximum of 30 photos. Delete one before adding another.",
  "error": "Bad Request"
}
```

The count happens **before** the upload, so a rejected photo never reaches the
CDN.

## 5. Deleting

```bash
curl -s -X DELETE "$URL/groups/6a6b.../photos/file_abc" \
  -H "Authorization: Bearer $TOKEN"
```

> ⚠️ **A group route cannot delete an event's photo**, even though the gallery
> shows it. Use `DELETE /events/:id/photos/:fileId` — the event that owns a
> photo stays the thing that governs it. A `fileId` belonging to an event
> returns `404` from the group route.

An unknown `fileId` is a `404`. The row is deleted first and the CDN file
second: if the remote delete fails the request still succeeds, because a leaked
file is better than a row whose URL 404s for every viewer.

## 6. Event photos

Unchanged in shape — `POST /events/:id/photos` and
`DELETE /events/:id/photos/:fileId` still work exactly as before, still
organizer-only, and still restricted to the **`after_match`** status.

What changed is *where* they are stored: the shared collection rather than an
array on the event document. That is what makes them appear in the group
gallery. The response is still `{ photos: [...] }`.

> **`event.photos` on the event document is deprecated** and no longer written.
> Read photos from the endpoints, not from the event object.

## 7. Gotchas checklist

- [ ] **The group gallery includes event photos.** Check `targetType` before
      assuming a photo was uploaded to the group.
- [ ] **The cap is per TARGET** — 30 per group *and* 30 per event, not 30 total.
- [ ] **Uploading is owner/admin; viewing is any member.** A captain or ordinary
      member can look but not add.
- [ ] **Delete an event's photo through the EVENT route**, even though it shows
      in the group gallery.
- [ ] **Event photos still require `after_match`** — uploading earlier is a 400
      naming the current status.
- [ ] **Field name is `file`**, lowercase, and do not set a `Content-Type`
      header yourself.
- [ ] **`uploadedBy` is recorded** but nothing enforces it yet — any owner/admin
      can delete any photo.
