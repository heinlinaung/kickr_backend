# Refresh Token Support — Design

Date: 2026-07-08

## Problem

`kickr-backend` currently issues a single JWT on login with no refresh
mechanism (`src/auth/auth.service.ts`). Once it expires, the client must
re-authenticate with credentials. This adds refresh token support so
clients can silently renew a session without forcing a re-login.

## Architecture

- Login (`POST /auth/login`) returns both:
  - `token` — access token, signed with `JWT_SECRET`, expiry `JWT_EXPIRES_IN` (60m).
  - `refreshToken` — signed with a separate secret `JWT_REFRESH_SECRET`,
    expiry `JWT_REFRESH_EXPIRES_IN` (30d).
- New endpoint `POST /auth/refresh` accepts `{ refreshToken }` in the
  request body, validates it, rotates it, and returns a fresh
  `{ token, refreshToken }` pair.
- Refresh tokens are rotated on every use. Reuse of an already-rotated
  token is rejected (treated as theft signal), without maintaining a
  full token table.

## Data model

`User` schema (`src/users/schemas/user.schema.ts`) gains one field:

```ts
@Prop({ default: 0 })
refreshTokenVersion: number;
```

Refresh JWT payload: `{ sub: userId, ver: refreshTokenVersion }`.

On `POST /auth/refresh`:
1. Verify the refresh token's signature and expiry against `JWT_REFRESH_SECRET`.
2. Look up the user by `sub`. If not found → 401.
3. Compare payload `ver` to `user.refreshTokenVersion`.
   - Match → increment `user.refreshTokenVersion`, issue a new token
     pair embedding the new version.
   - Mismatch → 401 (token was already rotated out / replayed).

On login, the returned refresh token is signed with the user's current
`refreshTokenVersion` (no bump needed at login time — only refresh
rotates it).

This field is excluded from `toJSON` output and from
`USER_SENSITIVE_PROJECTION`-style responses so it never appears in API
responses, consistent with how other internal-only fields are handled
in the schema today (`user.schema.ts:55-65`).

## Components

- **`auth.service.ts`**
  - Extract a private `issueTokens(user)` helper that signs both the
    access and refresh JWTs, used by both `login` and the new
    `refreshTokens` method — avoids duplicating signing logic.
  - Add `refreshTokens(dto: RefreshTokenDto)`:
    - Verify + decode the refresh token using `JWT_REFRESH_SECRET`
      (via `jwtService.verify(token, { secret })`).
    - Load the user, check version, rotate, return new pair.
    - Throw `UnauthorizedException` with a generic message for every
      failure mode (invalid signature, expired, version mismatch, user
      not found) — don't leak which case occurred.
- **`auth.controller.ts`**
  - Add `POST /auth/refresh`, `@HttpCode(HttpStatus.OK)`, delegating to
    `authService.refreshTokens(dto)`.
- **`dto/refresh-token.dto.ts`** (new)
  - `{ refreshToken: string }` with `@IsString() @IsNotEmpty()` and
    `@ApiProperty()`, matching the style of existing DTOs
    (`login.dto.ts`, `forgot-password.dto.ts`).
- **`auth.module.ts`**
  - No second `JwtModule` registration. Sign/verify the refresh token
    by passing explicit `{ secret, expiresIn }` overrides to the
    existing injected `JwtService` per-call, since `@nestjs/jwt`
    supports per-call secret/expiry overrides.
- **`user.schema.ts`**
  - Add `refreshTokenVersion` field; exclude from `toJSON` transform.

## Config

New env vars (values set in deployment config, not the repo):
- `JWT_REFRESH_SECRET`
- `JWT_REFRESH_EXPIRES_IN` (e.g. `30d`)

## Error handling

| Case | Response |
|---|---|
| Malformed / bad signature refresh token | 401 Unauthorized |
| Expired refresh token | 401 Unauthorized |
| Version mismatch (replayed/rotated-out token) | 401 Unauthorized |
| User not found (deleted after token issued) | 401 Unauthorized |

All cases return the same generic message to avoid leaking which
failure mode occurred.

## Testing

- `AuthService.refreshTokens` unit tests:
  - Valid refresh token → rotation succeeds, version bumped, new pair
    returned, new refresh token's embedded version matches the bumped
    value.
  - Reused (already-rotated-out) refresh token → rejected.
  - Expired refresh token → rejected.
  - Refresh token for a deleted/missing user → rejected.
- `AuthController` test confirming the new route is wired to
  `authService.refreshTokens`.

## Out of scope

- Logout / session revocation endpoints (explicitly deferred).
- Per-device session tracking or a refresh-token collection.
- httpOnly cookie transport (body-based transport chosen instead).
