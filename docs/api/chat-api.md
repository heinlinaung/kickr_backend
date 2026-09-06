# Group chat API (for the Flutter app)

Group messaging over two doors into the same room: **REST** for sending and
reading, **socket.io** for receiving live.

> ⚠️ Written from source, not captured live.

---

## 1. The two doors

| | Use it for |
|---|---|
| `POST /groups/:id/messages` | Sending. Persists, then broadcasts. |
| socket.io `sendMessage` | Sending, when a socket is already open. |
| socket.io `newMessage` | **Receiving** — the only way to get messages live. |
| `GET /groups/:id/messages` | History, and recovering anything a dropped socket missed. |

**Both send paths emit the same `newMessage` event to the same room**, so a
client cannot tell which door a message came through — and should not care.

Which to use: REST is simpler and works without a live socket, so a client that
sends over REST and only *listens* over the socket is a perfectly good design.
Sending over the socket saves a round trip when one is already connected.

## 2. Sending — `POST /groups/:id/messages`

```bash
curl -s -X POST "$URL/groups/6a6b2366f78b66d63a911a9e/messages" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"See everyone at 7pm"}'
```

```json
{
  "data": {
    "_id": "68b9f1aa22bb33cc44dd0001",
    "groupId": "6a6b2366f78b66d63a911a9e",
    "senderId": {
      "_id": "507f191e810c19729de860e1",
      "name": "Hein",
      "profileImage": "https://ik.imagekit.io/kickr/profiles/abc.png"
    },
    "text": "See everyone at 7pm",
    "createdAt": "2026-09-06T10:00:00.000Z"
  }
}
```

**`senderId` is an object, not an id** — the sender is populated with `name` and
`profileImage` so a client can render the bubble without a second lookup. This
is the same shape `GET` returns, so a just-sent message renders identically to a
historical one.

`senderId` is taken from the access token, never the body. Sending one is a
**400** (`property senderId should not exist`).

### Text rules

| Rule | Behaviour |
|---|---|
| Trimmed | Leading/trailing whitespace removed **before** validation |
| Blank | `400` — `"   "` is not a message |
| Max length | 2000 characters; 2001 is a `400` |
| Newlines | Preserved inside the message; only the ends are trimmed |

### Access

**Members only.** A non-member gets `403`, and a **pending join request counts
as a non-member** — the same gate as reading history, so someone who cannot see
a group's messages cannot post into it either.

## 3. Receiving — socket.io

Namespace **`/chat`**. Join the group's room, then listen:

```dart
final socket = io('$baseUrl/chat', OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'token': accessToken})   // Cognito ACCESS token
    .build());

socket.emit('joinRoom', {'groupId': groupId});
socket.on('newMessage', (data) => appendToChat(data));
```

The token **must be the access token** — an id token is rejected and the socket
disconnected.

`joinRoom` checks membership too; a non-member gets an `error` event rather than
being joined.

> ⚠️ **A missed broadcast is not a lost message.** The message is persisted
> before it is broadcast, and a socket failure never fails the send. If a client
> reconnects after a drop, `GET /groups/:id/messages` is the recovery path —
> there is no replay of missed socket events.

## 4. History — `GET /groups/:id/messages`

```bash
curl -s "$URL/groups/6a6b2366f78b66d63a911a9e/messages?limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

Returns an array, **newest first**, sender populated. `limit` defaults to 50 and
is capped at 200.

> ⚠️ **Not cursor-paginated**, unlike `/notifications` and the search endpoints.
> `limit` is a simple cap with no `nextCursor`, so there is currently no way to
> page back beyond the most recent 200 messages. Worth knowing before building
> infinite scroll.

## 5. Ordering

Messages carry `createdAt` and history sorts on it, newest first. Two messages
sent in the same millisecond have no defined order between them — there is no
tiebreaker on this route, unlike the notification feed. In practice human typing
makes that vanishingly rare.

## 6. Gotchas checklist

- [ ] **`senderId` is an OBJECT** (`{_id, name, profileImage}`), not a string.
- [ ] **Never send `senderId`** — it comes from the token, and sending it is a 400.
- [ ] **Whitespace-only text is a 400**, not an empty message.
- [ ] **A pending join request cannot post**, exactly as it cannot read.
- [ ] **Listen on `newMessage`** regardless of which door you send through.
- [ ] **`joinRoom` first**, or the socket receives nothing — joining the room is
      what subscribes you.
- [ ] **The socket needs the access token**, not the id token.
- [ ] **History is capped at 200 and has no cursor.** No deep paging yet.
- [ ] **A delivered HTTP 201 means STORED**, even if no socket saw it. Trust the
      response, not the broadcast.
