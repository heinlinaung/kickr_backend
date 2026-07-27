# Verified Email Change — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user move their account to an email address they actually control, proving ownership of the new address before the change takes effect. Needed because the KickR-v2 pool signs in by email and a pre-sign-up Lambda auto-confirms every registration, so a user can be stranded on a typo'd or third-party address with no way to correct it.

**Design doc:** [2026-07-27-email-change-verification-design.md](../specs/2026-07-27-email-change-verification-design.md) — read it first. It explains why this cannot be a `PATCH /users/me` field and why the pool setting in Task 0 is a hard prerequisite.

**Architecture:** Two authenticated endpoints on the users module. `POST /users/me/email` stages the change in Cognito (`AdminUpdateUserAttributes` → `email_verified: false`) and sends a code to the **new** address; Mongo is untouched. `POST /users/me/email/verify` calls `VerifyUserAttribute` with the caller's access token and, only on success, writes the new email to Mongo. `cognitoSub` is the join key and never changes, so profile/history/chat all survive the change.

**Tech Stack:** NestJS 11 · `@aws-sdk/client-cognito-identity-provider` (already a dep; all required commands verified present) · MongoDB (Mongoose) · existing `CognitoService` + `mapCognitoError`.

**Key constraint:** `GetUserAttributeVerificationCode` and `VerifyUserAttribute` are **user-pool APIs authenticated by the caller's access token**, not admin/IAM APIs. The codebase does not currently expose the raw token to services — `CurrentUser` returns the Mongo document and `JwtStrategy` discards the bearer token. Task 2 adds that plumbing.

---

## Design decisions (locked)

1. **Two-step flow, verify-then-write.** Mongo's `email` is written only after Cognito confirms the code. The reverse order can leave a profile claiming an address the user never proved.
2. **Access token via a dedicated `@AccessToken()` decorator**, not by attaching the token to `request.user`. Widening the user object risks the token leaking into a response body, since the user object is returned directly by `GET /users/me`.
3. **Uniqueness checked in both stores.** Pre-check Mongo for a clean 409 before any AWS call, *and* map `AliasExistsException`, because a Cognito user whose Mongo profile failed during the signup dual-write is invisible to the Mongo check.
4. **`email`/`emailVerified` stay out of `UpdateProfileDto`** — permanently. That DTO is the write-whitelist for `$set: dto`.
5. **No application-level rate limiter.** Cognito throttling (`LimitExceededException` → 503) is already mapped and is sufficient for v1.

---

## Security boundary (must hold)

- `email` and `emailVerified` must NEVER appear in `UpdateProfileDto`. Task 6 includes a regression test asserting a payload containing them does not change those fields.
- The Mongo `email` write happens ONLY in the verify handler, after `VerifyUserAttribute` resolves.
- Both endpoints act only on the caller's own account, derived from the JWT. Neither accepts a target user id.
- The access token must never appear in a response body.
- `emailVerified` is set from the verified outcome, never from client input.

---

## File Structure

**Create:**
- `src/common/decorators/access-token.decorator.ts` — `@AccessToken()`, reads the bearer token off the request.
- `src/users/dto/change-email.dto.ts` — `{ newEmail }`, `@IsEmail()`.
- `src/users/dto/verify-email.dto.ts` — `{ code }`, `@IsString()`.

**Modify:**
- `src/auth/cognito/cognito.service.ts` — add `startEmailChange(sub, newEmail, accessToken)` and `confirmEmailChange(accessToken, code)`.
- `src/auth/cognito/cognito.errors.ts` — map `AliasExistsException` → 409.
- `src/users/users.service.ts` — add `requestEmailChange`, `confirmEmailChange`.
- `src/users/users.controller.ts` — add the two routes.
- `src/users/users.module.ts` — import `AuthModule`/`CognitoService` if not already reachable (check before assuming).
- `README.md` — document both endpoints and the pool prerequisite.

**Tests:** `cognito.service.spec.ts`, `users.service.spec.ts`, `users.controller.spec.ts`, plus a new `test/email-change.e2e-spec.ts`.

---

## Task 0: Pool configuration prerequisite (BLOCKING — human decision)

**This task changes live AWS infrastructure. Do not automate it without explicit sign-off.**

The flow is unsafe until `AttributesRequireVerificationBeforeUpdate` includes `email`. Verified current state of `ap-southeast-1_8NpoRlnZe` on 2026-07-27: the list is **empty**, `AutoVerifiedAttributes: ["email"]`, `email` is `Mutable: true`.

- [ ] **Step 1: Capture the current pool config in full**

```bash
aws cognito-idp describe-user-pool --user-pool-id ap-southeast-1_8NpoRlnZe \
  --region ap-southeast-1 > /tmp/pool-before.json
```

- [ ] **Step 2: Apply the setting**

⚠️ `update-user-pool` **replaces the entire configuration** — any field omitted reverts to its default, including `LambdaConfig`, which would silently detach `cognito-pre-sign-up-auto-confirmed` and break signup. Either pass every existing field back, or make this change in the AWS console (recommended).

Target state: `UserAttributeUpdateSettings.AttributesRequireVerificationBeforeUpdate = ["email"]`

- [ ] **Step 3: Verify nothing else moved**

```bash
aws cognito-idp describe-user-pool --user-pool-id ap-southeast-1_8NpoRlnZe \
  --region ap-southeast-1 > /tmp/pool-after.json
diff <(jq -S . /tmp/pool-before.json) <(jq -S . /tmp/pool-after.json)
```

The diff must show **only** `AttributesRequireVerificationBeforeUpdate`. Confirm `LambdaConfig.PreSignUp` is still present.

- [ ] **Step 4: Smoke-test that signup still auto-confirms** — sign up a throwaway address and assert `UserStatus: CONFIRMED` without admin intervention. If this regressed, Task 0 Step 2 clobbered the Lambda; restore from `pool-before.json`.

---

## Task 1: Map `AliasExistsException` to 409

**Files:** Modify `src/auth/cognito/cognito.errors.ts` · Test `src/auth/cognito/cognito.errors.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('maps AliasExistsException to 409', () => {
  const err = Object.assign(new Error('alias exists'), { name: 'AliasExistsException' });
  expect(mapCognitoError(err)).toBeInstanceOf(ConflictException);
});
```

- [ ] **Step 2: Run it — must fail** (currently falls through to `default:` → `BadRequestException`).
- [ ] **Step 3: Add the case** alongside `UsernameExistsException`, message `'Email already registered'`.
- [ ] **Step 4: Run — passes.**

---

## Task 2: `@AccessToken()` decorator

**Files:** Create `src/common/decorators/access-token.decorator.ts` · Test `src/common/decorators/access-token.decorator.spec.ts`

Needed because `VerifyUserAttribute` is a user-pool API requiring the caller's access token, and `CurrentUser` returns the Mongo document instead.

- [ ] **Step 1: Write the failing test** — build a mock `ExecutionContext` with `Authorization: Bearer abc.def.ghi`; assert the decorator factory returns `'abc.def.ghi'`. Add cases for a missing header and a non-`Bearer` scheme (both → `undefined`, so the service layer produces a clean 401 rather than sending `undefined` to AWS).
- [ ] **Step 2: Run — fails** (file does not exist).
- [ ] **Step 3: Implement** with `createParamDecorator`, mirroring `current-user.decorator.ts`. Strip the `Bearer ` prefix case-insensitively.
- [ ] **Step 4: Run — passes.**

---

## Task 3: `CognitoService.startEmailChange`

**Files:** Modify `src/auth/cognito/cognito.service.ts` · Test `src/auth/cognito/cognito.service.spec.ts`

- [ ] **Step 1: Write the failing test** using `aws-sdk-client-mock`:
  - `AdminUpdateUserAttributesCommand` receives `Username: <sub>`, `UserAttributes: [{Name:'email',Value:<lowercased new email>}, {Name:'email_verified',Value:'false'}]`.
  - `GetUserAttributeVerificationCodeCommand` receives `AttributeName: 'email'` and the access token.
  - An `AliasExistsException` from AWS surfaces as `ConflictException` (via Task 1).

> **Note on `Username`:** for this email-sign-in pool the physical Cognito username is the `sub` UUID, not the email. Confirmed empirically — `admin-get-user` returns `Username: 69ca359c-…`. Admin commands must pass the sub. This is the same trap that caused the refresh-token bug (see `CognitoService.refresh`).

- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement**, wrapping in `try/catch` → `mapCognitoError`, consistent with every other method.
- [ ] **Step 4: Run — passes.**

---

## Task 4: `CognitoService.confirmEmailChange`

**Files:** Modify `src/auth/cognito/cognito.service.ts` · Test `src/auth/cognito/cognito.service.spec.ts`

- [ ] **Step 1: Write the failing test** — `VerifyUserAttributeCommand` receives `AccessToken`, `AttributeName: 'email'`, `Code`. Assert `CodeMismatchException` → 400 and `ExpiredCodeException` → 400 (already mapped; pin the behavior).
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** with the same `try/catch` → `mapCognitoError`.
- [ ] **Step 4: Run — passes.**

---

## Task 5: `UsersService.requestEmailChange` / `confirmEmailChange`

**Files:** Modify `src/users/users.service.ts` · Test `src/users/users.service.spec.ts`

**Wiring is required, not optional** (verified 2026-07-27): `AuthModule` exports only `[PassportModule, CognitoJwtVerifier]` — **not** `CognitoService` — and `UsersModule` does not import `AuthModule` at all. So before any of the steps below:

- [ ] Add `CognitoService` to `AuthModule`'s `exports`.
- [ ] Add `AuthModule` to `UsersModule`'s `imports`.
No circular dependency is expected: `AuthModule` imports the `User` **schema** via `MongooseModule.forFeature`, not `UsersModule` itself, so `UsersModule → AuthModule` is a one-way edge. If a cycle does appear, extract `CognitoService` into its own `CognitoModule` that both import rather than reaching for `forwardRef()`.

- [ ] **Step 1: Write the failing tests**
  - `requestEmailChange` lowercases `newEmail` before any call.
  - Throws 409 when another user already holds that email (`_id: { $ne: userId }`).
  - Throws 400 when `newEmail` equals the caller's current email.
  - **Mongo is NOT written** on request — assert `findByIdAndUpdate` was never called.
  - `confirmEmailChange` calls Cognito first, then sets `email` + `emailVerified: true`.
  - **If Cognito rejects the code, Mongo is NOT written** — the critical ordering assertion.
  - A Mongo `code: 11000` on the final write surfaces as 409.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.** The verify handler must re-read the staged address (from Cognito's response or a stored pending value) rather than trusting a client-supplied email on step 2 — otherwise a user could verify address A and write address B.
- [ ] **Step 4: Run — passes.**

---

## Task 6: Routes + DTOs

**Files:** Create both DTOs · Modify `src/users/users.controller.ts` · Test `src/users/users.controller.spec.ts`

- [ ] **Step 1: Write the failing tests** — both routes delegate to the service with the caller's id and the access token; both are guarded; `POST /users/me/email` with a malformed address is rejected by the `ValidationPipe`.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** `POST /users/me/email` and `POST /users/me/email/verify`, both `@HttpCode(HttpStatus.OK)`, `@ApiTags`-documented.
- [ ] **Step 4: Regression test the security boundary** — `PATCH /users/me` with `{ email, emailVerified }` in the body must leave both unchanged (the pipe strips them). This is the guard against someone "simplifying" the design later.
- [ ] **Step 5: Run — passes.**

---

## Task 7: E2E with Cognito mocked

**Files:** Create `test/email-change.e2e-spec.ts`

Model on `test/auth-cognito.e2e-spec.ts`, which mocks `CognitoIdentityProviderClient` and needs no live env.

- [ ] **Step 1: Write the tests**
  - Happy path: request → 200, Mongo unchanged; verify → 200, Mongo now holds the new email with `emailVerified: true`.
  - Wrong code → 400 and Mongo unchanged.
  - Duplicate email → 409 before any AWS call.
  - Unauthenticated → 401 on both routes.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Make them pass.**

---

## Task 8: Live verification against KickR-v2

Only after Task 0 is applied. Mocks cannot catch the `Username`-must-be-`sub` trap or a wrong SECRET_HASH — the refresh-token bug passed every mocked test and still failed against real Cognito.

- [ ] **Step 1:** Sign up a throwaway address you control; confirm it is auto-confirmed.
- [ ] **Step 2:** `POST /users/me/email` to a second real address. Assert: a code arrives at the **new** address, and **sign-in still works with the old address** (this is what Task 0 buys).
- [ ] **Step 3:** `POST /users/me/email/verify` with the code → 200. Assert `admin-get-user` shows the new email with `email_verified: true`, and Mongo matches.
- [ ] **Step 4:** Sign in with the new address → 200. Sign in with the old → 401.
- [ ] **Step 5:** Assert `cognitoSub` is unchanged and the profile (groups, history) is intact.
- [ ] **Step 6:** Delete the test users from Cognito and Mongo.

---

## Task 9: Documentation

- [ ] **Step 1:** Add both endpoints to the README endpoint table.
- [ ] **Step 2:** Document the pool prerequisite in the Authentication notes — a fresh environment without `AttributesRequireVerificationBeforeUpdate` will appear to work while being unsafe, which is the worst kind of misconfiguration.
- [ ] **Step 3:** Note that signup auto-confirms and that this is the only path to a genuinely verified address.

---

## Verification checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `npx jest` — all unit tests pass
- [ ] `npx jest --config test/jest-e2e.json auth-cognito email-change` pass
- [ ] `npx eslint src test` — no new errors (5 pre-existing in `cognito.service.spec.ts` / `jwt.strategy.spec.ts`)
- [ ] Task 8 completed against the live pool
- [ ] Test users cleaned from Cognito **and** Mongo

## Deferred (documented, not built)

- Notifying the **old** address when a change is requested — the standard takeover-visibility measure. Needs a mail path the backend does not own today.
- Re-verification sweep for accounts auto-confirmed without proof.
- Cooldown between successive changes (Cognito throttling only for now).
