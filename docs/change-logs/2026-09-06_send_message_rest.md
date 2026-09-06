# Change Log — 2026-09-06 · `POST /groups/:id/messages`

**Branch:** `events-feature-spec`
**Tests:** 991 passing across 49 suites · build clean
**Verified:** unit only — mocked Mongoose, and **no socket client has ever
received a REST-sent broadcast**. §7. Usage examples in §6.

Send a group message over REST. Persists to MongoDB, then broadcasts to the
group's socket.io room.

---

## 1. What already existed

Most of this was in place, which shaped the work:

| Piece | State |
|---|---|
| `Message` schema, `{groupId, createdAt}` index | ✅ existed |
| `ChatService.saveMessage` | ✅ existed |
| `GET /groups/:id/messages` | ✅ existed |
| socket `sendMessage` handler | ✅ existed |
| **`POST /groups/:id/messages`** | ❌ **missing — this change** |

So the endpoint is a REST door onto an existing room, not a new subsystem. The
guiding constraint was that it must be **indistinguishable** from the socket
path to anyone listening.

## 2. One event, one room, either door

The socket handler emits `newMessage` to a room named by `groupId`. The REST
route now does exactly the same, via a new `ChatGateway.broadcastMessage`.

That method exists so the controller does not reach into `server` itself: the
room name and event name are decided in **one place**, so the two paths cannot
drift. A client listening for `newMessage` must not care which door a message
came through, and a test asserts the broadcast object is the *same* object the
HTTP response returns.

## 3. Store first, broadcast second

Ordering is asserted by a test, not left to chance.

Emitting first would show other members a message that might then fail to save.
The reverse — a message stored but not broadcast — is a missing live update,
recoverable by re-reading history.

`broadcastMessage` therefore **swallows its own errors**: a socket problem must
not fail an HTTP request for a message that *was* stored. Returning 500 there
would be actively misleading, since the client would retry and duplicate it.

## 4. Access: the same gate as reading

`getMemberRole` returns `null` for a non-member **and for a pending join
request**, so an unapproved requester can neither read the history nor post into
it. Reusing the exact call the `GET` route uses is deliberate — a divergence
would let someone post into a group they cannot see.

A test pins both routes rejecting the same caller, so the two cannot drift
apart.

`senderId` comes from the access token and is **not** accepted in the body;
`forbidNonWhitelisted` makes sending one a 400. Worth stating because a
caller-supplied sender id would let anyone forge a message from another member.

## 5. Text handling

Trimmed **before** validation, via `@Transform`. Order matters: validating
first would let `"   "` pass `MinLength(1)` and store a blank message that
renders as an empty bubble.

Capped at 2000 characters so one client cannot write an unbounded document.
Newlines inside the message survive — only the ends are trimmed, and a
multi-line message is legitimate.

## 6. Usage

Set these once:

```bash
URL=http://localhost:3000
TOKEN=<Cognito ACCESS token>          # the access token, never the id token
GROUP=6a6b2366f78b66d63a911a9e
```

### Send a message

```bash
curl -s -X POST "$URL/groups/$GROUP/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
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

`201 Created`. **`senderId` is an object, not a string** — populated so the
client can render the bubble without a second lookup, and identical to what
`GET` returns.

### Read it back

```bash
curl -s "$URL/groups/$GROUP/messages?limit=50" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0]'
```

Newest first. `limit` defaults to 50, capped at 200.

### Multi-line text

Only the ends are trimmed, so newlines inside survive:

```bash
curl -s -X POST "$URL/groups/$GROUP/messages" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"Kick-off 7pm\nBring both kits"}'
```

### The failure cases

Every message below was captured from the real validator, not written from
memory.

**Blank text** — trimming happens *before* validation, so whitespace-only fails
rather than storing an empty bubble:

```bash
curl -s -X POST "$URL/groups/$GROUP/messages" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"   "}'
```

```json
{
  "statusCode": 400,
  "message": ["text must be longer than or equal to 1 characters"],
  "error": "Bad Request"
}
```

**Over 2000 characters:**

```json
{ "message": ["text must be shorter than or equal to 2000 characters"] }
```

**Trying to forge a sender** — `senderId` comes from the token, so supplying one
is refused outright:

```bash
curl -s -X POST "$URL/groups/$GROUP/messages" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"hi","senderId":"507f191e810c19729de860e2"}'
```

```json
{ "message": ["property senderId should not exist"] }
```

**Not a member** (or a pending join request, which counts the same):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$URL/groups/$GROUP/messages" \
  -H "Authorization: Bearer $OTHER_USERS_TOKEN" \
  -H 'Content-Type: application/json' -d '{"text":"let me in"}'
# 403
```

Note errors are **flat** — `{statusCode, message, error}` — while success
responses are wrapped in `data`.

### Watching the broadcast

The REST send is only half the story; a listening client should receive it too.
Quickest check without writing an app:

```bash
npx -y wscat -c "ws://localhost:3000/chat?token=$TOKEN"
```

Then in the socket session, join the room and wait:

```json
{"event":"joinRoom","data":{"groupId":"6a6b2366f78b66d63a911a9e"}}
```

POST from another terminal and a `newMessage` event should arrive — carrying
the same populated shape as the HTTP response. That is the check §7 calls out
as unverified.

## 7. What is NOT verified

- **No socket client has received a REST-sent broadcast.** The gateway is
  mocked in every test, so `broadcastMessage` is asserted to be *called* with
  the right room and payload — not that socket.io actually delivers it. This is
  the single most valuable thing to check by hand.
- **No live database.** Mongoose is mocked; the populate has never run against
  real data, though `ChatService.createMessage` was separately exercised
  against a fake model to confirm it casts both ids to ObjectId, populates only
  `name profileImage`, and returns the resolved sender.
- **No concurrency check.** Two members sending in the same millisecond have no
  defined order between them — history sorts on `createdAt` alone, with no
  `_id` tiebreaker, unlike the notification feed. Left as-is because human
  typing makes a collision vanishingly rare, but it is a real difference.

### To verify by hand

```bash
# 1. open a socket client on /chat, joinRoom for the group, listen for newMessage
# 2. then, from a DIFFERENT session:
curl -s -X POST "$URL/groups/<id>/messages" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"hello from REST"}'
# 3. the socket client should receive it, with senderId populated
```

Step 3 failing while the HTTP call returns 201 would mean the broadcast is not
reaching the room — the one failure mode the unit tests cannot see.

## 8. Tests

19 new cases across two specs.

**Controller (9):** stores for a member; 403 for a non-member; **writes nothing
when refused** (the check must gate the write, not merely precede it);
membership is checked for the group in the URL as the authenticated caller;
both routes reject the same caller; broadcasts to the group room; broadcasts
the same object it returns; stores before broadcasting; and does **not**
broadcast when the write fails.

**DTO (10):** ordinary message; trimming; whitespace-only, empty, missing and
non-string all rejected; exactly 2000 accepted and 2001 rejected; unknown
properties rejected — `senderId` specifically; newlines preserved.

**Verified by reverting:** removing the membership gate from the POST handler
fails **4 of the 9** controller tests. Restored, all pass.

## 9. Not done

- **No pagination on history.** `GET` still takes a `limit` capped at 200 with
  no cursor, so there is no way to page back beyond the most recent 200
  messages. Out of scope here, but it blocks infinite scroll and is the obvious
  next change.
- **No edit or delete.** A sent message is permanent.
- **No read receipts, typing indicators or attachments.**
- **No notification on a new message.** Chat is not one of the two push
  triggers, so a member with the app closed learns nothing until they open it.
