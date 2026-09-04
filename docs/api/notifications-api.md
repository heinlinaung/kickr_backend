# Notifications API (for the Flutter app)

Three delivery channels for the same notification:

| Channel | Use it for |
|---|---|
| `GET /notifications` | The in-app list, **paginated** (`{items, nextCursor, hasMore}`). **The source of truth** — always correct. |
| socket.io `/notifications` | Live banner while the app is open. |
| FCM push | Reaching the user when the app is closed. |

> **The event-created trigger is verified end to end on web**: device
> registered via `POST /notifications/devices`, an event created by another
> account, and the recipient's OS showed the notification. **Not yet verified:**
> the `ready_to_play` trigger, and mobile — Android is unexercised and iOS
> cannot receive push until an APNs key is uploaded (§5b).
>
> ⚠️ The REST payload shapes below are still written from source rather than
> captured from live calls; treat them as intended rather than confirmed.

**Design rule you can rely on:** a notification never fails the action that
triggered it. Creating an event succeeds even if every notification channel is
down. The corollary is that **a missing banner does not mean a missing action** —
if you need certainty, read the list.

---

## 1. What triggers a notification today

Only two things:

| Trigger | Who receives it | Title |
|---|---|---|
| An event is created in a group | Approved members of that group, **except the creator** | `New event` |
| An event moves to `ready_to_play` | Users **currently joined to that event** | `Teams are ready` |

Both carry `type: "event"` and `refId` set to the **event id**, so a tap can
deep-link straight to the event.

Notes on the audience, because both exclusions are deliberate:

- **The creator is not told about their own event.** Being notified of your own
  action is noise.
- **Pending join-requesters get nothing.** Approval is what grants visibility;
  a private group's event must not leak to someone still waiting.
- **Guests (`+1`/`+2`) get nothing** on `ready_to_play`. They have no account
  and no device — tell their sponsor.
- **Standalone (non-group) events announce to nobody.** There is no audience.

Everything else in the app — join approvals, chat, scores, payments — has **no
notification yet**.

## 2. Registering a device

Push requires the device's FCM token to be registered. Nothing arrives until it
is.

### `POST /notifications/devices`

```json
{ "fcmToken": "eyJhbGci...long-opaque-string", "platform": "android" }
```

`platform` is one of `ios` · `android` · `web`.

**Call it:**
- after the Firebase SDK returns a token on login, **and**
- every time the SDK reports a token refresh (`onTokenRefresh`).

Registering the same token twice is safe — it refreshes rather than
duplicating. A user may have any number of devices and **all** of them receive
push.

> The token is also **detached from any other account** that had registered it.
> A shared or handed-over phone never keeps receiving the previous user's
> notifications.

### `DELETE /notifications/devices/:fcmToken`

**Call this on logout.** Without it, push keeps arriving on a device the user
has signed out of — the notification is addressed to the *device*, not the
session.

An unknown token is a no-op, not a `404`: the desired end state is "not
registered" either way.

### You cannot read the tokens back

`devices` is excluded from **every** user-facing response, including
`GET /users/me`. An FCM token is a push credential — anyone holding one can
send notifications to that device. The client already holds its own token and
only ever POSTs it.

## 3. The live socket

Namespace **`/notifications`** — separate from `/chat`.

```dart
final socket = io('$baseUrl/notifications', OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'token': accessToken})   // Cognito ACCESS token
    .build());

socket.on('notification', (data) => showBanner(data));
```

The token may also be passed as `?token=`. It **must be the access token** — an
id token is rejected and the socket is disconnected, the same rule as the REST
API.

One event is emitted: **`notification`**, whose payload is the same object the
list returns (§4).

Delivery is per-user, not per-group: every device with an open socket for that
account receives it.

> A failed or absent socket costs a banner, never the notification. It is still
> in the list.

## 4. The in-app list

### `GET /notifications` — paginated, newest first

```
GET /notifications?limit=20&cursor=eyJkIjoi...
```

| Query | Default | Notes |
|---|---|---|
| `limit` | `20` | Page size, clamped to **1–50**. A non-numeric value falls back to 20 rather than erroring. |
| `cursor` | — | Opaque. Pass the previous response's `nextCursor` **verbatim**; omit for the first page. |

```json
{
  "data": {
    "items": [
      {
        "_id": "68b2...",
        "userId": "68a1...",
        "title": "Teams are ready",
        "body": "Friday night five — check your team and get ready to play.",
        "type": "event",
        "refId": "68b0...",
        "isRead": false,
        "createdAt": "2026-09-02T14:31:07.221Z"
      }
    ],
    "nextCursor": "eyJkIjoiMjAyNi0wOS0wMlQxNDozMTowNy4yMjFaIiwiaSI6IjY4YjIifQ",
    "hasMore": true
  }
}
```

> ⚠️ **BREAKING — changed 2026-09-04.** `data` was a bare **array**; it is now
> an object with `items` / `nextCursor` / `hasMore`. A client doing
> `response.data.map(...)` breaks — read `response.data.items` instead.

**Paging:** keep calling with the previous `nextCursor` until it comes back
`null`. `hasMore: false` and `nextCursor: null` always agree, so either is a
valid stop condition. Treat the cursor as opaque — it is a position marker, not
an API, and its encoding may change without notice. A malformed cursor gives
**400**, not an empty page.

> ⚠️ **The read field is `isRead`, not `read`.** An earlier version of this doc
> said `read`; that was wrong and a client trusting it would see `undefined`
> and render everything as unread.

#### Unread items are no longer floated to the top

The unpaginated version sorted by `isRead` first, so unread notifications
appeared above read ones. **Now the sort is `createdAt` alone (newest first).**

That is a deliberate consequence of paginating: `isRead` *changes*, and marking
something read mid-pagination would move that row to a different page, making
the cursor skip or duplicate rows. `createdAt` never changes, so every page
boundary stays put.

Every row still carries `isRead`, so group, badge or filter client-side. For an
unread count, count what you have loaded, or track it locally from
`PATCH .../read` calls — there is no `unreadCount` field.

`refId` + `type` are the deep-link pair. For `type: "event"`, `refId` is an
event id.

### `PATCH /notifications/:id/read` · `PATCH /notifications/read-all`

Mark one read, or all of them.

## 5. Server setup (not the app's problem, but worth knowing)

Push is **disabled** unless three env vars are set on the server:

```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

Without them the server logs a warning at startup and every push is a no-op —
the list and the socket still work. So **"no push in dev" is expected**, not a
bug, and the way to tell is the server's startup line: `Firebase push enabled
for project …` versus the warning.

## 5b. iOS needs an APNs key before any push arrives

FCM cannot reach an iPhone on its own — Apple requires an **APNs authentication
key** (`.p8`) or certificate uploaded to *Project settings > Cloud Messaging >
Apple app configuration*. As of 2026-09-02 the project has **neither**, so
`platform: "ios"` registrations are accepted and stored but **no push will be
delivered** to them.

Android and Web are unaffected: Android needs only `google-services.json`, and
Web needs a Web Push certificate (*Generate key pair* on the same page).

This is a console/Apple-account task, not a backend one — nothing in this API
changes when the key is added.

> Also note the iOS app is currently registered as `com.example.kickr`, the
> Flutter template default. An APNs key is scoped to a bundle ID, so fix the
> bundle ID before configuring it.

## 6. Gotchas checklist

- [ ] **Nothing arrives until `POST /notifications/devices` is called.** A
      logged-in user with no registered device gets list + socket only.
- [ ] **Re-register on token refresh.** FCM rotates tokens; a stale one is
      silently dropped and eventually pruned server-side.
- [ ] **Deregister on logout**, or the next user of that device may see a
      banner meant for the previous one until they log in.
- [ ] **The socket needs the access token**, not the id token.
- [ ] **Only two triggers exist.** Do not build UI implying notifications for
      join approvals, chat or scores.
- [ ] **The creator gets no notification for their own event** — do not treat
      its absence as a failure.
- [ ] **Guests never receive anything.** They have no account.
- [ ] **iOS delivers nothing until an APNs key is uploaded** (§5b) — a
      successful `POST /notifications/devices` is not evidence push works.
- [ ] **`GET /notifications` is paginated** (changed 2026-09-04) — `data` is now
      `{ items, nextCursor, hasMore }`, not an array. `data.map(...)` breaks.
- [ ] **Unread rows are no longer sorted to the top.** Newest-first only; badge
      or filter on `isRead` yourself. A mutable sort key cannot be paginated.
- [ ] **The read flag is `isRead`**, not `read`.
- [ ] **Round-trip `nextCursor` untouched.** It is opaque, unsigned, and a
      malformed value gives 400 rather than an empty page.
- [ ] **`devices` is never readable.** Do not expect it on `GET /users/me`.
- [ ] **A missing banner is not a missing action.** The list is authoritative;
      notification delivery is best-effort by design.
- [ ] Tokens FCM rejects as permanently invalid are **pruned server-side**, so
      a device that reinstalls without deregistering cleans itself up
      eventually.
