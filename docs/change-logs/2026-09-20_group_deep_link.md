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

## Still open (needs domain + TLS)

True OS-level "open the app instead of the browser" (Android App Links /
iOS Universal Links) requires the invite link to be HTTPS on a verified
domain serving `/.well-known/assetlinks.json` and
`/.well-known/apple-app-site-association`. On the current raw-IP HTTP
deployment the browser hop via the landing page's scheme redirect is the
best achievable; revisit when the API gets a domain.
