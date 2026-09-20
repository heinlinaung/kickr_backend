# 2026-09-20 — group deep link (`kickrsport://group/<id>`) in QR flow

## What changed

The app's deep link format (`kickrsport://group/$groupId`, registered by the
Flutter app) is now wired through the whole QR journey.

### `GET /groups/:id/qr` — two new fields

```json
{
  "data": {
    "inviteCode": "455e848b-...",
    "inviteLink": "http://<APP_BASE_URL>/g/455e848b-...",
    "deepLink": "kickrsport://group/6a6b2366f78b66d63a911a9e",
    "groupId": "6a6b2366f78b66d63a911a9e",
    "expiresAt": "2026-09-21T09:15:00.000Z"
  }
}
```

The QR still ENCODES `inviteLink` (the https URL): a camera scan of a custom
scheme dead-ends when the app is missing, while the https link degrades to
the landing page. `deepLink`/`groupId` are for in-app consumers — the app's
own scanner or share sheet can jump straight to the group details screen
without resolving the code first.

### `GET /g/:code` — the landing page jumps into the app

- The HTML page now auto-attempts `kickrsport://group/<id>` (30ms redirect):
  a phone WITH the app lands directly on the group details page, which is the
  scan-to-app flow. Without the app the scheme is unregistered, nothing
  navigates, and the page (now with a visible **Open in KickR** button, plus
  the join code) remains the fallback.
- The JSON variant carries `deepLink` alongside the group preview.

Deep link paths live in `src/common/deep-links.ts` so the QR response and
the landing page cannot drift; the Flutter app's route table is the
authority on the format.

## How the mobile side handles this

### 1. Rendering the QR (group admin screen)

Call `GET /groups/:id/qr` and render the QR **client-side from the
`inviteLink` string** (e.g. [`qr_flutter`](https://pub.dev/packages/qr_flutter)):

```dart
QrImageView(data: qr.inviteLink, size: 240);
```

Encode `inviteLink`, never `deepLink` — a scheme URL dead-ends on phones
without the app. The API deliberately returns no image; a locally rendered
QR is crisp at any size and restyleable without an API change.

### 2. Registering the scheme (once per platform)

The app owns `kickrsport://` and must declare it or the redirect does nothing:

- **Android** — `AndroidManifest.xml`, inside the main activity:

  ```xml
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="kickrsport" android:host="group" />
  </intent-filter>
  ```

- **iOS** — `Info.plist`: add `kickrsport` under
  `CFBundleURLTypes → CFBundleURLSchemes`, and (when using `app_links`)
  `FlutterDeepLinkingEnabled = NO`.

### 3. Handling the incoming link

Use [`app_links`](https://pub.dev/packages/app_links); instantiate it early so
the cold-start link (app launched BY the scan) is not lost:

```dart
final appLinks = AppLinks();
final initial = await appLinks.getInitialLink();   // cold start
appLinks.uriLinkStream.listen(_handle);            // app already running

void _handle(Uri? uri) {
  if (uri == null) return;
  // kickrsport://group/<groupId> → host 'group', first segment = id
  if (uri.scheme == 'kickrsport' && uri.host == 'group') {
    final groupId = uri.pathSegments.first;
    router.push('/groups/$groupId');   // group details; join CTA lives there
  }
}
```

The user may not be a member yet: the details screen should render the
public card (`GET /groups/:id` already narrows private groups for
non-members) with a **Request to join** button that posts the scanned code
to `POST /invitations/groups/join-by-code`.

### 4. The in-app QR scanner

A scan from INSIDE the app never leaves it, so handle both URL shapes the
QR journey produces:

- `kickrsport://group/<groupId>` → navigate directly (id is in the URL);
- `http(s)://…/g/<code>` (the QR's actual content) → either call
  `GET /g/<code>` with `Accept: application/json` and navigate to
  `data.group._id` (the response also carries `data.deepLink`), or just
  keep the `<code>` for join-by-code.

Hold the scanned `code` in state either way — it is what
`join-by-code` needs, and codes expire after 24h so resolve failures
("Invalid or expired invite code", 404) should surface as "ask for a fresh
QR", not a crash.

### 5. Camera-app scan (no KickR involvement)

Nothing to build: the phone opens `inviteLink` in the browser, the landing
page auto-fires `deepLink`, and step 3 takes over if the app is installed.

## Still open (needs domain + TLS)

True OS-level "open the app instead of the browser" (Android App Links /
iOS Universal Links) requires the invite link to be HTTPS on a verified
domain serving `/.well-known/assetlinks.json` and
`/.well-known/apple-app-site-association`. On the current raw-IP HTTP
deployment the browser hop via the landing page's scheme redirect is the
best achievable; revisit when the API gets a domain.
