# Refresh Token Usage

How clients use the access/refresh token pair issued by this API.

## Overview

- `POST /auth/login` returns an access token (`token`) and a refresh token (`refreshToken`).
- `token` is short-lived (`JWT_EXPIRES_IN`, default `15m`) and goes in the `Authorization: Bearer <token>` header for all authenticated requests.
- `refreshToken` is long-lived (`JWT_REFRESH_EXPIRES_IN`, default `30d`). When `token` expires, exchange `refreshToken` for a new pair via `POST /auth/refresh` instead of asking the user to log in again.
- Every refresh **rotates** the refresh token: the old one becomes invalid immediately, and the response contains a new `refreshToken` that must replace the one the client stored. Reusing an already-rotated token returns `401 Invalid refresh token`.

## Example

```bash
# 1. Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret123"}'
```

```json
{
  "data": {
    "token": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "user": { "_id": "...", "email": "user@example.com" }
  }
}
```

```bash
# 2. Use the access token
curl http://localhost:3000/users/me \
  -H "Authorization: Bearer eyJhbGciOi..."   # the `token` value
```

```bash
# 3. Access token expired -> refresh
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"eyJhbGciOi..."}'      # the `refreshToken` value
```

```json
{
  "data": {
    "token": "eyJhbGciOi...(new)",
    "refreshToken": "eyJhbGciOi...(new, replaces the old one)"
  }
}
```

```bash
# 4. Reusing the OLD refresh token now fails
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"eyJhbGciOi...(old)"}'
```

```json
{
  "statusCode": 401,
  "message": "Invalid refresh token",
  "error": "Unauthorized"
}
```

## Client responsibilities

- Store both tokens (e.g. secure storage on mobile, memory/httpOnly-adjacent storage on web).
- On any `401` from an authenticated request, attempt one `/auth/refresh` call, then retry the original request with the new `token`. If refresh also fails, redirect to login.
- Always overwrite the stored `refreshToken` with the value from the latest `/auth/refresh` (or `/auth/login`) response — never reuse a previous one.

## Out of scope

No logout endpoint exists yet; clients discard tokens locally to "log out." See `2026-07-08-refresh-tokens-design.md` for the full design and deferred items.
