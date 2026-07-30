# Auth API (Login / Refresh / Signup) — Flutter Integration Guide

**Audience:** Flutter developers integrating KickR authentication.
**Base URL (local):** `http://localhost:3000` · **Swagger:** `/api-docs`
**Identity provider:** AWS Cognito (the backend proxies to it — the app never talks to Cognito directly).
**Status:** verified end-to-end against the live API on 2026-07-30. Every request/response below was captured from a real call.
**See also:** [Groups & Locations API](./groups-and-locations-api.md) — the feature endpoints that consume these tokens.

---

## 0. The five things that will bite you

Read these before writing any code.

1. **Sign in with `email`** — not username, not phone.
2. **Send the `accessToken`** on protected routes, **never the `idToken`**. An id token is rejected with `401`.
3. **`POST /auth/refresh` needs `sub`, not `email`.** `sub` is the Cognito user id, returned by login at the top level. Sending an email gives a misleading `401 Invalid credentials`.
4. **Refresh does NOT return a new `refreshToken`** — only a new `accessToken`/`idToken`. Keep the original refresh token in storage.
5. Success bodies are wrapped in **`data`**; error bodies are **flat**, and `message` may be a **string or a list of strings**.

---

## 1. Response envelope

**Success** (`200`/`201`):
```json
{ "data": { "...": "payload" } }
```

**Error** (any 4xx/5xx) — note: *no* `data` wrapper:
```json
{
  "statusCode": 400,
  "timestamp": "2026-07-30T10:18:34.382Z",
  "path": "/auth/signup",
  "message": ["email must be an email", "password must be longer than or equal to 8 characters"],
  "error": "Bad Request"
}
```

```dart
class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);
  @override
  String toString() => message;
}

/// Unwraps `data`, or throws ApiException with a readable message.
dynamic unwrap(http.Response res) {
  final body = jsonDecode(res.body) as Map<String, dynamic>;
  if (res.statusCode >= 400) {
    final m = body['message'];
    throw ApiException(
      res.statusCode,
      m is List ? m.join('\n') : (m?.toString() ?? 'Request failed'),
    );
  }
  return body['data'];
}
```

---

## 2. Endpoints

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/auth/signup` | `email`, `password` | Register |
| `POST` | `/auth/login` | `email`, `password` | Get tokens |
| `POST` | `/auth/refresh` | **`sub`**, `refreshToken` | New access token |
| `POST` | `/auth/forgot-password` | `email` | Send reset code |
| `POST` | `/auth/reset-password` | `email`, `code`, `newPassword` | Complete reset |
| `POST` | `/auth/confirm-signup` | `email`, `code` | Confirm account (see §3.2) |
| `POST` | `/auth/resend-confirmation` | `email` | Resend confirmation code |

None require an `Authorization` header. All are `POST`.

---

## 3. Signup

### 3.1 Request / response

`POST /auth/signup`
```json
{ "email": "player@example.com", "password": "Password123!" }
```
→ `201`
```json
{ "data": { "message": "Signup successful. You can now log in." } }
```

Validation: `email` must be a valid email · `password` **min 8 chars**, and must satisfy the Cognito pool policy (**uppercase + lowercase + number + symbol**). A policy failure comes back as `400` with Cognito's wording, so surface `message` directly.

### 3.2 Users are auto-confirmed — no email code needed

A Cognito PreSignUp trigger auto-confirms new accounts, so **the user can log in immediately after signup**. Verified: signup → login with no code in between.

That means:
- **Do not build a "check your email for a code" screen into the signup happy path.** Go straight to login (or auto-login).
- `/auth/confirm-signup` and `/auth/resend-confirmation` exist and work, but are **not needed** in the current configuration. Keep them out of the main flow; they'd only matter if auto-confirm is turned off later.

### 3.3 Duplicate email

→ `409`
```json
{ "statusCode": 409, "message": "Username already registered", "error": "Conflict" }
```
> The message says "Username" but it refers to the **email** (email is the sign-in identifier). Show your own copy, e.g. *"An account with that email already exists."*

### 3.4 Profile created alongside

Signup creates the Cognito identity **and** a Mongo profile linked by `cognitoSub`. Currently `name` is defaulted from the email prefix and **`username` is `null`** — see §8.

---

## 4. Login

`POST /auth/login`
```json
{ "email": "player@example.com", "password": "Password123!" }
```
→ `200`
```json
{
  "data": {
    "accessToken": "eyJraWQiOi...",
    "idToken": "eyJraWQiOi...",
    "refreshToken": "eyJjdHkiOi...",
    "expiresIn": 3600,
    "sub": "194a757c-9031-70d3-0afb-6a0e67ab53dd",
    "user": {
      "_id": "6a66ff6775eaff06079c36dd",
      "cognitoSub": "194a757c-9031-70d3-0afb-6a0e67ab53dd",
      "email": "player@example.com",
      "name": "player",
      "username": null,
      "emailVerified": false,
      "sports": [],
      "privacy": { "profileVisibility": "public", "showStats": true, "showMatchHistory": true },
      "highlightVideos": [],
      "gallery": [],
      "createdAt": "...", "updatedAt": "..."
    }
  }
}
```

### What to persist

| Value | Store? | Why |
|---|---|---|
| `accessToken` | yes (secure) | Sent as `Authorization: Bearer` on every protected call |
| `refreshToken` | **yes (secure)** | The only way to get a new access token; **never re-issued** |
| **`sub`** | **yes** | **Required by `/auth/refresh`.** Also available as `user.cognitoSub`. |
| `expiresIn` | yes | Seconds until the access token expires (currently `3600`) |
| `idToken` | optional | Contains profile claims. **Do not send it as your bearer token.** |
| `user` | yes | Seeds the profile UI without an extra `GET /users/me` |

Use `flutter_secure_storage` (Keychain / Keystore) for the tokens and `sub`, not `SharedPreferences`.

### Errors

| Case | Response |
|---|---|
| Wrong password | `401 Invalid credentials` |
| Unknown email | `401 Invalid credentials` (identical — deliberately no account enumeration) |
| Malformed email / empty password | `400` with a `message` list |
| Account not confirmed (only if auto-confirm is disabled) | `403 Account not confirmed` |

Because wrong-password and unknown-email are indistinguishable, show one generic message: *"Email or password is incorrect."*

---

## 5. Refresh — the important one

`POST /auth/refresh`
```json
{
  "sub": "194a757c-9031-70d3-0afb-6a0e67ab53dd",
  "refreshToken": "eyJjdHkiOi..."
}
```
→ `200`
```json
{
  "data": {
    "accessToken": "eyJraWQiOi...",
    "idToken": "eyJraWQiOi...",
    "expiresIn": 3600
  }
}
```

### Three rules

1. **The field is `sub`, not `email`.** The backend computes a Cognito `SECRET_HASH` over the `sub`; an email produces a wrong hash and you get `401 Invalid credentials` — which looks like "bad password" but isn't. Verified.
2. **No new `refreshToken` is returned.** Keep reusing the stored one until it fails.
3. **On `401` from refresh, the session is over.** Clear storage and route to login. Cognito refresh tokens are long-lived but do expire (and are invalidated by a password reset).

### Recommended interceptor

```dart
class AuthInterceptor {
  final AuthStore store;      // secure storage for tokens + sub
  final http.Client client;
  AuthInterceptor(this.store, this.client);

  Future<http.Response> send(
    Future<http.Response> Function(String accessToken) call,
  ) async {
    var token = await store.accessToken;
    var res = await call(token!);

    if (res.statusCode != 401) return res;

    // one refresh attempt, then retry once
    final refreshed = await _refresh();
    if (!refreshed) {
      await store.clear();
      throw ApiException(401, 'Session expired. Please sign in again.');
    }
    token = await store.accessToken;
    return call(token!);
  }

  Future<bool> _refresh() async {
    final sub = await store.sub;
    final refreshToken = await store.refreshToken;
    if (sub == null || refreshToken == null) return false;

    final res = await client.post(
      Uri.parse('$baseUrl/auth/refresh'),
      headers: {'Content-Type': 'application/json'},
      // NOTE: `sub`, NOT email
      body: jsonEncode({'sub': sub, 'refreshToken': refreshToken}),
    );
    if (res.statusCode >= 400) return false;

    final data = jsonDecode(res.body)['data'] as Map<String, dynamic>;
    await store.saveAccessToken(
      data['accessToken'] as String,
      expiresIn: data['expiresIn'] as int,
    );
    // deliberately do NOT touch the stored refreshToken — none is returned
    return true;
  }
}
```

**Guard against a refresh stampede:** if several requests 401 at once they will each try to refresh. Keep a single in-flight `Future<bool>` and have concurrent callers await it.

Proactive refresh is also fine: refresh when the token is within ~5 minutes of `expiresIn`, avoiding a user-visible 401 round-trip.

---

## 6. Password reset

Two steps.

**1 — request a code:** `POST /auth/forgot-password`
```json
{ "email": "player@example.com" }
```
→ `200` (always the same, whether or not the account exists — no enumeration):
```json
{ "data": { "message": "If that account exists, a reset code has been sent." } }
```
So **never** tell the user "no account found" here; say *"If that email is registered, we've sent a code."*

**2 — submit the code:** `POST /auth/reset-password`
```json
{ "email": "player@example.com", "code": "123456", "newPassword": "NewPassword123!" }
```
→ `200` with a success message.

| Error | Meaning |
|---|---|
| `400 Invalid or expired code` | Wrong or stale code → let them re-request |
| `400` + policy text | `newPassword` fails the Cognito policy |
| `503 Too many attempts, retry later` | Cognito rate limit → back off, disable the button briefly |

> ⚠️ **Email delivery caveat:** the pool currently uses Cognito's built-in email sender, which is rate-limited (~50/day) and often lands in spam. Codes may not arrive reliably until the pool is moved to Amazon SES. Worth knowing while testing — it is an infrastructure setting, not an app bug.

---

## 7. Tokens in practice

### Attaching the access token
```dart
headers: {
  'Authorization': 'Bearer $accessToken',
  'Content-Type': 'application/json',
}
```

### Why not the idToken
Protected routes require `token_use == "access"` on the JWT. Passing the id token → `401 Unauthorized`. Verified. This applies to REST **and** the chat WebSocket.

### Token facts (observed)
- `accessToken` — RS256, `expiresIn: 3600` (1 h), claims include `sub` and `token_use: "access"`.
- `refreshToken` — long-lived, issued **only at login**.
- Verification is against the Cognito JWKS; you don't need to validate locally, but decoding `exp` client-side is useful for proactive refresh.

### Logout
There is **no logout endpoint**. Logging out is a client-side action: clear the stored tokens and `sub`, then route to login.

---

## 8. Known gaps — don't design against these

| Item | Reality |
|---|---|
| **`user.username` is `null`** | Auto-generating a username from the display name is specified but **not implemented**. `name` is defaulted from the email prefix. Don't show `username` as the primary handle yet; it is editable via `PATCH /users/me`. |
| `emailVerified` is `false` | Cognito owns real verification; this Mongo field isn't synced and nothing gates on it. **Ignore it.** |
| Phone-number sign-in | Design doc only — not implemented. Sign-in is email. |
| Verified email change | Design doc only — not implemented. |
| Social login (Google/Facebook) | Removed; not available. |
| Logout / token revocation | No endpoint (see §7). |
| Refresh-token rotation | Not done — the same refresh token is reused. |

---

## 9. Status codes

| Code | Where | Handling |
|---|---|---|
| `200`/`201` | success | — |
| `400` | validation, bad/expired reset code, weak password | show `message` (may be a list) |
| `401` | login failure; refresh failure; id token used as bearer | login → generic message; refresh → clear session |
| `403` | account not confirmed (only if auto-confirm is off) | prompt to confirm |
| `409` | signup with an existing email | "account already exists" |
| `503` | Cognito rate limit | back off and retry later |

---

## 10. Flow summary

```
Signup ──> POST /auth/signup ──> 201
              │  (auto-confirmed: no code step)
              ▼
Login  ──> POST /auth/login ──> { accessToken, refreshToken, sub, expiresIn, user }
              │                        │
              │  store all four ───────┘  (secure storage)
              ▼
Protected calls: Authorization: Bearer <accessToken>
              │
              ├── 200 ─> continue
              └── 401 ─> POST /auth/refresh { sub, refreshToken }
                            ├── 200 ─> save new accessToken, retry once
                            └── 401 ─> clear storage, go to Login
```

Forgot password: `POST /auth/forgot-password { email }` → user gets a code → `POST /auth/reset-password { email, code, newPassword }` → back to Login.

---

## 11. Checklist

- [ ] Sign in with **`email`** + password.
- [ ] Store `accessToken`, `refreshToken`, **`sub`**, and `expiresIn` in secure storage.
- [ ] Send **`accessToken`** as bearer — never `idToken`.
- [ ] Refresh with **`{ sub, refreshToken }`** — **not** `{ email, ... }`.
- [ ] Don't overwrite the stored refresh token after refreshing (none is returned).
- [ ] Single-flight the refresh call so parallel 401s don't stampede.
- [ ] On refresh `401`: clear storage → login screen.
- [ ] Skip the confirmation-code screen in the signup happy path (auto-confirm is on).
- [ ] Same generic error for wrong-password and unknown-email.
- [ ] Never reveal account existence on forgot-password.
- [ ] Handle `message` being a **string or a list**.
- [ ] Implement logout client-side (no endpoint).
