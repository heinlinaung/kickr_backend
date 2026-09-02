# Web push test harness

Verifies FCM delivery end to end without building a mobile app. Web is the
fastest path: no Xcode, no Android Studio, and no Apple Developer account
(iOS additionally needs an APNs key, which the project does not yet have).

Nothing here is imported by the app — it is standalone tooling.

## What you need first

A **Web app** registered in Firebase (console → Project settings → General →
Your apps). If only the iOS app exists, add one — it takes a moment and gives
you the `apiKey` and `appId` the page asks for.

Also a **Web Push certificate** (console → Cloud Messaging → Web configuration
→ *Generate key pair*). That value is the `vapidKey`.

> The VAPID key is a **browser** credential, not a server one. `PushService`
> never reads it — it authenticates with the service account. It only needs to
> reach the page.

## Browser support

Use **Chrome** if you have a choice. Web push needs the browser's own push
service, and privacy-focused browsers often disable it:

- **Brave** ships Google push messaging **off**. Turn it on at
  `brave://settings/privacy` → *Use Google services for push messaging*, then
  restart by opening **`brave://restart` in a new tab** and re-check the toggle
  afterwards: the in-page *Relaunch* button historically flipped it back off
  ([brave-browser#6633](https://github.com/brave/brave-browser/issues/6633),
  since fixed). Without the setting you get
  `Registration failed - push service error`.

  The tell that this is the cause: **permission is granted and the service
  worker registers fine**, and it fails only at the subscription. The
  Notification API and the Push API are separate, and Brave blocks only the
  latter. It also fails on *every* web-push site, not just this one —
  `brave://gcm-internals` will show no registration.
- **Safari** supports web push only from 16.4, and macOS requires the site to
  be added to the Dock. Not worth fighting for a test.
- **Firefox** works, but uses Mozilla's autopush service rather than FCM.

This is a browser limitation, not a Firebase or backend problem — the same
token, once obtained, works identically.

## Run it

```bash
# 1. Serve the page. The service worker must be at the ROOT of the origin,
#    which is why the server's document root is this directory.
cd webpush-test && python3 -m http.server 8080

# 2. Open http://localhost:8080
#    Not file:// and not a LAN IP — the Notification API requires a secure
#    context, and only localhost counts as secure over plain HTTP.

# 3. Paste the five config values, click "Get FCM token", allow the
#    permission prompt, and copy the token from the log.

# 4. Send to it, from the REPO ROOT so .env is found:
node webpush-test/send.js "<paste-the-token>"
```

`SENT ✓ message id: …` plus a visible notification means push works.

> **Confirmed working 2026-09-02** on Brave/macOS after enabling Brave's push
> setting — the notification rendered via the service worker's background path.

**Background the tab (or focus another window) before sending.** A focused page
receives the message through `onMessage` and logs it instead of showing an OS
notification — that split is FCM's design, and it is the usual reason for
"the send succeeded but I saw nothing".

## Testing through the API instead

Steps 1–3 above, then use the page's **"Register with API"** button with a
Cognito **access** token. That calls
`POST /notifications/devices`, so the token is stored against your user and the
real triggers reach it.

The API must allow the page's origin:

```
CORS_EXTRA_ORIGINS=http://localhost:8080
```

Then exercise the real triggers:

- **Event created** → notifies the group's approved members **except the
  creator**. Test with a second account, or nothing is sent and it looks broken.
- **Event → `ready_to_play`** → notifies users who **joined that event**, not
  merely group members.

## When it fails

| Symptom | Cause |
|---|---|
| `Registration failed - push service error` (code 20 / AbortError) | **The browser refused the subscription**, before Firebase was involved. Brave ships Google push messaging disabled — enable it in `brave://settings/privacy` and restart Brave fully. Chrome is the quickest alternative. |
| `messaging/registration-token-not-registered` | Stale token. Reload and get a fresh one. |
| `messaging/invalid-argument` | Token truncated on copy — it is ~160 chars. |
| `messaging/mismatched-credential` | Token is from a different Firebase project than the service account in `.env`. |
| `applicationServerKey is not valid` | Wrong `vapidKey` for this project. |
| Abort even after enabling Brave's setting | A subscription already exists under a **different** VAPID key — likely if the key was regenerated. The page now unsubscribes and retries automatically; if it persists, clear site data for `localhost:8080`. |
| Permission prompt never appears | Already denied. Reset via the padlock in the address bar. |
| `HTTP 401` on register | Expired token, or an **id** token instead of an **access** token. |
| CORS error on register | `CORS_EXTRA_ORIGINS` not set, or the API was not restarted after setting it. |
| Send succeeds, nothing visible | The tab was focused — check the page log, or background it and resend. |

## Files

| File | Role |
|---|---|
| `index.html` | Requests permission, registers the worker, fetches the token, optionally registers it with the API. Config persists in `localStorage`. |
| `firebase-messaging-sw.js` | Service worker; shows notifications that arrive while the page is backgrounded. |
| `send.js` | Sends one push using the same credentials and SDK calls as `PushService`, but **bypasses the API** — so a failure here means Firebase, and a failure through the API means our code. |
