# Change Log — 2026-09-02 · Push notifications (socket.io + Firebase)

**Branch:** `events-feature-spec`
**Tests:** 873 passing across 41 suites · build clean
**Verified:** unit, plus a live credential check against the real Firebase
service account (init succeeds, `isEnabled: true`). **No push has reached a
device** — see §7 for the boundary.

Two events now reach the user's phone:

| Trigger | Audience |
|---|---|
| Event created | Approved members of the event's group, **minus the creator** |
| Event status → `ready_to_play` | Users **currently joined to that event** |

---

## 1. Two transports, one payload

Every notification goes out three ways, in this order:

1. **A `Notification` row** — persisted first, and the source of truth for the
   in-app list at `GET /notifications`.
2. **socket.io** — live delivery to anyone with the app open.
3. **FCM** — a push to every registered device.

The ordering is deliberate. The row is written **before** either delivery is
attempted, so a socket drop or an FCM outage costs the user a banner, never the
notification itself — they still see it in the list. If delivery came first, a
failure would lose the notification entirely.

## 2. A notification can never fail the request that triggered it

This was the explicit requirement, and it drove most of the structure.

Creating an event and advancing its status are the transactions. The
notification is a side effect. So:

- `PushService` swallows and logs every error, returning `{sent: 0}` rather
  than throwing.
- `notifyUsers` wraps persistence and push in `try/catch` and resolves
  `{notified: 0, pushed: 0}` on failure.
- Both call sites in `EventsService` (`notifyGroupOfNewEvent`,
  `notifyRosterReadyToPlay`) are themselves wrapped, and log at `error`.

**Each socket emit is wrapped individually, not the loop.** `emitToUser` is
synchronous, so a single throwing recipient would otherwise abort the remaining
emits, skip the push branch entirely, and reject into the caller — one
unreachable socket would both silence FCM for everyone else and `500` the event
creation. A unit test asserts this specific case; it failed before the fix.

## 3. FCM is optional, and absence is a supported state

With no `FIREBASE_*` credentials present, `PushService` logs a warning at
startup and every send is a no-op. Local development and CI need no Firebase
project, and the rest of the feature — rows, sockets, the API — behaves
identically.

Three env vars enable it:

```
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

`FIREBASE_PRIVATE_KEY` accepts the key **either way**. Init runs
`.replace(/\\n/g, '\n')`, so a single-line value carrying literal `\n`
sequences is restored to a real PEM — necessary because many env-var stores
cannot hold newlines. A value that already contains real newlines (what the
Firebase console's JSON gives you, and what a quoted multi-line `.env` entry
preserves) passes through untouched.

Quote the value either way, or it truncates at the first space in
`BEGIN PRIVATE KEY`.

## 4. Devices are an array, and tokens are credentials

`User.devices` is `[{ fcmToken, platform, updatedAt }]`, not a single field.
One account is routinely signed in on several devices, and a reinstall issues a
fresh token without immediately invalidating the old one. A single field would
silence every device but the most recent, and give no way to deregister just
one on logout.

**`USER_SENSITIVE_PROJECTION` changed from `-__v` to `-__v -devices`.** An FCM
token is a push credential: anyone holding one can send notifications to that
device. Without this exclusion `GET /users/me` would hand them back over the
wire, and the JWT strategy would attach them to `request.user` on every
authenticated request. The client never needs to read them — it already holds
its own token, and only ever POSTs it.

Two housekeeping behaviours matter:

- **Registering a token detaches it from any other account first.** A shared or
  handed-over device must not keep receiving the previous user's notifications.
- **Tokens FCM reports as permanently invalid are pruned.** Only
  `registration-token-not-registered` and `invalid-argument` count as
  permanent — a network blip or a quota error must never delete a token that is
  still good. Without pruning the array only grows and every send wastes calls
  on uninstalled apps.

## 5. One multicast, not one send per user

`pushToUsers` collects every token of every recipient and issues a **single**
`sendEachForMulticast`. FCM charges and rate-limits per call, so a group of 30
would otherwise be 30 round trips. A test asserts the call count is exactly 1.

FCM requires all `data` values to be strings; a test asserts that too, because
a number there fails the send at runtime with a message that does not obviously
point at the cause.

## 6. Its own socket namespace

The gateway serves `/notifications`, separate from `/chat`. Chat rooms are
per-group; notification delivery is **per-user**, so each socket joins a room
named after the user's id and `emitToUser` addresses that room.

Handshake auth takes the Cognito **access** token from `handshake.auth.token`
(or `?token=`), verifies it, and rejects anything whose `token_use` is not
`access` — an id token is not an authorisation credential. The catch block
logs **nothing**: a malformed JWT's contents are themselves a credential.

## 7. What is NOT verified

Everything above is unit-tested against mocked Mongoose and a mocked FCM. In
particular, **none of this has run against a real Firebase project or a real
device**:

- No push has ever actually been delivered to a device. A real
  `sendEachForMulticast` was attempted against the live project on 2026-09-02
  but the sandbox blocks DNS (`ENOTFOUND fcm.googleapis.com`,
  `ENOTFOUND oauth2.googleapis.com`), so the request never left the machine.
  Everything up to the network boundary is exercised; the delivery itself is
  not.
- ~~The private-key `\n` conversion is untested against a real PEM.~~
  **Verified 2026-09-02** against the real Firebase service account:
  `PushService` initialises and reports `isEnabled: true`, and the key parses
  as a 2048-bit RSA key that can sign. Note the credential downloaded from the
  Firebase console carried **real newlines**, not literal `\n`, so the
  `.replace(/\\n/g, '\n')` was a harmless no-op — it still matters for
  deployments that inject the key through a single-line env var.
- The socket handshake has never been exercised by a real client; the gateway's
  auth path is covered only by reading.
- Token pruning's *permanent* codes are asserted against a mocked FCM error
  shape; the real `registration-token-not-registered` string is still
  unconfirmed. The *transient* branch, however, was verified against a genuine
  SDK error: an unreachable FCM yields `messaging/unknown-error`, which matches
  neither permanent pattern, so the token is kept. A network outage cannot
  delete valid device tokens.

**First-deploy checklist:** set the three env vars, confirm the startup log says
`Firebase push enabled for project …` rather than the warning, register a real
device via `POST /notifications/devices`, then create an event in a group with
a second member and confirm the banner arrives.

## 8. Firebase Admin SDK v14

Written against **firebase-admin ^14.3.0**, which uses modular subpath exports.
The v11/v12 namespaced API (`admin.credential.cert`, `admin.apps`,
`admin.messaging()`) is **gone** — on v14 the root export carries only
`initializeApp`, and the rest lives in `firebase-admin/app` and
`firebase-admin/messaging`. Code copied from older FCM tutorials will typecheck
against the shipped types but throw at runtime; this port hit exactly that.

## 9. Files

| File | Change |
|---|---|
| `notifications/push.service.ts` | new — FCM wrapper, disabled without credentials |
| `notifications/notifications.gateway.ts` | new — `/notifications` namespace, per-user rooms |
| `notifications/dto/register-device.dto.ts` | new |
| `notifications/notifications.service.ts` | `notifyUsers`, `pushToUsers`, device register/unregister |
| `notifications/notifications.module.ts` | registers `User` schema, imports `AuthModule` |
| `notifications/notifications.controller.ts` | `POST/DELETE devices` |
| `users/schemas/user.schema.ts` | `devices[]`, `USER_SENSITIVE_PROJECTION` excludes it |
| `events/events.service.ts` | both triggers |
| `notifications/notifications.service.spec.ts` | new — 13 fan-out tests |
| `events/events.service.lifecycle.spec.ts` | `ready_to_play` notification tests |

### A test that was passing for the wrong reason

The lifecycle spec's default `playerModel.find` was `mockResolvedValue([])` — a
plain promise with no `.select`. Since the real query is
`.find().select().sort().lean()`, the roster lookup threw a `TypeError` that the
announce path's own `try/catch` swallowed. Tests asserting "does not fire" and
"still advances when notifying throws" passed **without the notification code
ever being reached**.

The default is now chainable, and the throw-path test additionally asserts
`notifyUsers` was actually called. This is the third instance on this branch of
a mock that ignored the real query shape hiding a behavioural change.
