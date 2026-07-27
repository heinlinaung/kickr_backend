# Phone Number Sign-In — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users sign up and sign in with **either** an email address or a phone number. Phone is additive — email signup/login keeps working exactly as it does today, and the existing Flutter client (which sends `email`) must not break.

**Design doc:** [2026-07-27-phone-login-design.md](../specs/2026-07-27-phone-login-design.md) — read it first, especially the security finding on `phoneNumber` being client-settable.

**Architecture:** The DTOs accept a single `identifier` (with `email` retained as a deprecated alias). The server classifies it as E.164 phone or email, and that classification drives three things: which Cognito `UserAttributes` signup sets, which Mongo field login looks up, and how `name` is seeded. `CognitoService` otherwise needs no change — it already sends whatever identifier it is given as `Username` and hashes that same value, which is exactly what an alias pool needs.

**Tech Stack:** NestJS 11 · `@aws-sdk/client-cognito-identity-provider` · MongoDB (Mongoose) · pool `KickR-v3` `ap-southeast-1_7dkdUTpj1` (already configured: `UsernameAttributes: ["email","phone_number"]`, SMS wired, pre-sign-up Lambda attached).

**Verified starting state (2026-07-27):** email signup/login/refresh all work against v3. Phone is rejected at the DTO with `["email must be an email"]`. The `users` collection has **zero** documents with `phoneNumber` set, so the new unique index builds cleanly.

---

## Design decisions (locked)

1. **Single `identifier` field, classified server-side.** Not a `{type, value}` pair — the client sends what the user typed.
2. **`email` stays as a deprecated alias** on both DTOs. Breaking the Flutter client again, right after the `username` → `email` migration, is not acceptable.
3. **E.164 only** (`^\+[1-9]\d{1,14}$`). Local formats like `0812345678` are rejected — normalizing them needs a country the signup form does not collect.
4. **Explicit regex, not `@IsPhoneNumber()`.** The latter accepts national formats and is more permissive than Cognito.
5. **Branch the Mongo lookup, never `$or`.** An `$or` across `email`/`phoneNumber` would let one identity space match the other.
6. **`phoneNumber` leaves `UpdateProfileDto` in this feature** — see Task 2. Non-negotiable.

---

## Security boundary (must hold)

- `phoneNumber` / `phoneVerified` must NEVER be in `UpdateProfileDto` — same rule as `email`/`emailVerified`. Task 2 removes it and Task 8 regression-tests it.
- Classification is server-side only.
- Login branches on identifier type; no `$or`.
- `refresh()` keeps hashing the `sub` (regression test from `bbe1927` must stay green).
- Phone uniqueness enforced in **both** stores: unique sparse index + service pre-check.
- Existing `{ email, password }` request bodies keep working.

---

## File Structure

**Create:**
- `src/auth/identifier.util.ts` — `classifyIdentifier()`, `E164_REGEX`, `normalizeIdentifier()`.
- `src/auth/identifier.util.spec.ts`
- `test/phone-auth.e2e-spec.ts`

**Modify:**
- `src/auth/dto/signup.dto.ts`, `login.dto.ts` — `identifier` + deprecated `email`.
- `src/auth/auth.service.ts` — classify, branch signup attributes + login lookup, seed `name`.
- `src/auth/cognito/cognito.service.ts` — `signUp` takes the attribute name.
- `src/auth/cognito/cognito.errors.ts` — map `AliasExistsException` → 409.
- `src/users/schemas/user.schema.ts` — `phoneNumber` unique sparse, add `phoneVerified`, make `email` optional.
- `src/users/dto/update-profile.dto.ts` — **remove** `phoneNumber`.
- `README.md`

---

## Task 0: Confirm SMS can actually be delivered (BLOCKING)

There is no point building this if codes cannot reach a handset. Note the pre-sign-up Lambda auto-confirms, so *signup itself* sends no SMS — but password reset for a phone-only user does, and so will any future phone-verification flow.

- [ ] **Step 1: Check SNS sandbox status**

```bash
aws sns get-sms-sandbox-account-status --region ap-southeast-1
```

- [ ] **Step 2:** If sandboxed, either register a test destination number (`aws sns create-sms-sandbox-phone-number --phone-number '+65…'`) or request production access. Record which was done.
- [ ] **Step 3:** Send a test SMS end-to-end to confirm delivery before writing code. If this fails, stop — the remaining tasks are unverifiable.

> If SMS is blocked and you want to proceed anyway, phone *signup + password login* still work without any SMS (thanks to auto-confirm). Only recovery and future verification need delivery. Note the limitation explicitly rather than assuming it works.

---

## Task 1: Identifier classification utility

**Files:** Create `src/auth/identifier.util.ts` + spec

- [ ] **Step 1: Write the failing tests**

```ts
describe('classifyIdentifier', () => {
  it.each([
    ['+6581234567', 'phone'],
    ['+12025550123', 'phone'],
    ['user@example.com', 'email'],
    ['USER@Example.com', 'email'],
  ])('classifies %s as %s', (input, expected) => {
    expect(classifyIdentifier(input)).toBe(expected);
  });

  // local formats are NOT phone numbers — we cannot infer a country
  it.each(['0812345678', '81234567', '+0812345678', '+', 'not-an-identifier'])(
    'rejects %s as neither', (input) => {
      expect(() => classifyIdentifier(input)).toThrow(BadRequestException);
    });
});

describe('normalizeIdentifier', () => {
  it('lowercases emails', () => expect(normalizeIdentifier('A@B.com')).toBe('a@b.com'));
  it('leaves E.164 untouched', () => expect(normalizeIdentifier('+6581234567')).toBe('+6581234567'));
  it('strips incidental whitespace', () => expect(normalizeIdentifier(' +6581234567 ')).toBe('+6581234567'));
});
```

- [ ] **Step 2: Run — fails** (module does not exist).
- [ ] **Step 3: Implement.** `E164_REGEX = /^\+[1-9]\d{1,14}$/`. Anything starting with `+` that fails the regex is an error, not an email — otherwise `+garbage` would fall through to the email validator and produce a confusing message.
- [ ] **Step 4: Run — passes.**

---

## Task 2: Schema changes + remove `phoneNumber` from the profile DTO

**Files:** Modify `src/users/schemas/user.schema.ts`, `src/users/dto/update-profile.dto.ts` · Tests: `user.schema.spec.ts`, `update-profile.dto.spec.ts`

**This task contains the security fix.** See the design doc: `phoneNumber` is currently freely settable via `PATCH /users/me` with no uniqueness check and no verification. Once phone is a sign-in identity, that is an account-takeover primitive.

- [ ] **Step 1: Write the failing tests**
  - `phoneNumber` has a `unique` + `sparse` index.
  - `phoneVerified` exists, defaults to `false`.
  - `email` is no longer `required` (phone-only signup must be possible).
  - `UpdateProfileDto` **rejects** `phoneNumber` — a payload containing it is stripped by the whitelist pipe and the stored value is unchanged.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.** `@Prop({ unique: true, sparse: true }) phoneNumber`, `@Prop({ default: false }) phoneVerified`, drop `required: true` from `email`, delete `phoneNumber` from `UpdateProfileDto`.
- [ ] **Step 4: Verify the index builds against the real collection.** Zero documents currently have `phoneNumber` set, so this must succeed with no duplicate-key error. Confirm with `db.users.getIndexes()`.
- [ ] **Step 5: Run — passes.**

> **Invariant Mongoose cannot express:** at least one of `email` / `phoneNumber` must be present. Enforce it in `AuthService.signup` (Task 5), not the schema.

---

## Task 3: `AliasExistsException` → 409

**Files:** Modify `src/auth/cognito/cognito.errors.ts` · Test `cognito.errors.spec.ts`

More likely on v3 than v2, since the pool now has two alias attributes.

- [ ] **Step 1: Write the failing test** — `AliasExistsException` → `ConflictException`.
- [ ] **Step 2: Run — fails** (falls through to `default:` → 400).
- [ ] **Step 3: Implement**, message `'Email or phone number already registered'`.
- [ ] **Step 4: Run — passes.**

---

## Task 4: `CognitoService.signUp` sets the right attribute

**Files:** Modify `src/auth/cognito/cognito.service.ts` · Test `cognito.service.spec.ts`

Currently hard-codes `UserAttributes: [{ Name: 'email', Value: email }]`. A phone signup must set `phone_number` instead, or the user's alias will not match what they typed.

- [ ] **Step 1: Write the failing tests**
  - `signUp('+6581234567', pw, 'phone_number')` → `Username: '+6581234567'`, `UserAttributes: [{Name:'phone_number', Value:'+6581234567'}]`, `SECRET_HASH` over the phone.
  - `signUp('a@b.com', pw, 'email')` → unchanged from today (regression).
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** — add an attribute-name parameter. Keep `SECRET_HASH` over the identifier (correct for `SignUp`/`InitiateAuth`).
- [ ] **Step 4: Confirm the `refresh()` regression test from `bbe1927` still passes** — it must keep hashing the `sub`, not the identifier.
- [ ] **Step 5: Run — passes.**

---

## Task 5: `AuthService` — classify, branch, seed

**Files:** Modify `src/auth/auth.service.ts` · Test `auth.service.spec.ts`

- [ ] **Step 1: Write the failing tests**
  - **signup/email:** unchanged behavior — `name` seeded from local part, `email` written, `phoneNumber` absent.
  - **signup/phone:** `phone_number` attribute sent; Mongo gets `phoneNumber`, **no** `email`; `name` seeded to the E.164 string.
  - **signup:** 409 if the phone already exists in Mongo (pre-check before any AWS call).
  - **login/email:** `findOne({ email })` — unchanged.
  - **login/phone:** `findOne({ phoneNumber })`. Assert it is **not** an `$or`.
  - **Back-compat:** a body with `email` (no `identifier`) behaves exactly as before.
  - `refreshTokens` untouched (still `sub`).
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.** Enforce the at-least-one-identifier invariant here.
- [ ] **Step 4: Run — passes.**

---

## Task 6: DTOs with backward compatibility

**Files:** Modify `signup.dto.ts`, `login.dto.ts` · Tests alongside

The tricky part: accept `identifier` OR `email`, require exactly one, and keep old clients working.

- [ ] **Step 1: Write the failing tests**
  - `{ identifier: '+6581234567', password }` → valid.
  - `{ identifier: 'a@b.com', password }` → valid.
  - `{ email: 'a@b.com', password }` → valid (deprecated path).
  - `{ password }` alone → 400.
  - `{ identifier: '0812345678', password }` → 400 (local format).
  - `{ identifier: 'nonsense', password }` → 400.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** with `@ValidateIf` so `email` is only validated when `identifier` is absent. Mark `email` `@ApiProperty({ deprecated: true })` so Swagger shows the migration path.
- [ ] **Step 4: Run — passes.**

---

## Task 7: Password reset for phone-only users

**Files:** `forgot-password.dto.ts`, `reset-password.dto.ts`, `auth.service.ts` · Tests

`AccountRecoverySetting` is `verified_email` (1) then `verified_phone_number` (2). A phone-only user has no email, so recovery must go over SMS. The current endpoints assume email.

- [ ] **Step 1: Write the failing tests** — `forgotPassword({ identifier: '+65…' })` passes the phone to Cognito; the email path is unchanged.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** — same `identifier` treatment as Task 6.
- [ ] **Step 4: Run — passes.**

> Depends on Task 0. If SMS delivery is blocked, implement and unit-test it but mark the live check as blocked rather than claiming it works.

---

## Task 8: E2E with Cognito mocked

**Files:** Create `test/phone-auth.e2e-spec.ts` (model on `test/auth-cognito.e2e-spec.ts`)

- [ ] **Step 1: Write the tests**
  - Phone signup → `SignUpCommand` carries `phone_number` and the correct `SECRET_HASH`.
  - Phone login → `USERNAME` is the E.164 string.
  - Email signup/login → unchanged (regression).
  - Legacy `{ email }` body → still 201/200.
  - `0812345678` → 400, no AWS call.
  - Duplicate phone → 409 before any AWS call.
  - **Security regression:** `PATCH /users/me { phoneNumber }` does not change the stored value.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Make them pass.**

---

## Task 9: Live verification against KickR-v3

Mocks cannot catch a wrong `Username` or a bad `SECRET_HASH` — the refresh bug in `bbe1927` passed every mocked test and still failed against real Cognito. This task is mandatory.

- [ ] **Step 1:** Phone signup with a real E.164 number → 201. Confirm via `admin-get-user` that `Username` is the sub, `phone_number` is set, and status is `CONFIRMED` (auto-confirm Lambda).
- [ ] **Step 2:** Login with that phone → 200 with tokens.
- [ ] **Step 3:** `GET /users/me` with the token → 200, profile shows `phoneNumber`, no `email`.
- [ ] **Step 4:** `POST /auth/refresh` with the `sub` → 200 (proves the refresh path is identifier-agnostic).
- [ ] **Step 5:** Email signup + login in the same run → still 200 (no regression).
- [ ] **Step 6:** Legacy `{ email, password }` body → still works.
- [ ] **Step 7:** Duplicate phone signup → 409.
- [ ] **Step 8:** Delete every test user from Cognito **and** Mongo.

---

## Task 10: Documentation

- [ ] **Step 1:** README — document `identifier`, note `email` as deprecated-but-supported, and state the E.164 requirement plainly (this is the field most likely to cause client bugs).
- [ ] **Step 2:** Note that the pool must have `UsernameAttributes: ["email","phone_number"]` — it cannot be changed after creation, so a fresh environment must be created correctly.
- [ ] **Step 3:** Record the SNS sandbox state from Task 0.

---

## Verification checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `npx jest` — all pass, including the `bbe1927` refresh regression
- [ ] `npx jest --config test/jest-e2e.json auth-cognito phone-auth` pass
- [ ] `npx eslint src test` — no new errors (5 pre-existing)
- [ ] Task 9 completed against the live pool
- [ ] Test users cleaned from Cognito **and** Mongo
- [ ] Flutter client verified unbroken by the legacy `email` path

## Deferred (documented, not built)

- **Verified phone change** after signup — mirror of the email-change design. The DTO removal in Task 2 means there is temporarily *no* way to change a phone number; that is the correct trade-off (no way beats an unsafe way), but it should not stay that way long.
- SMS MFA (`MfaConfiguration: "OFF"`).
- Passwordless / OTP sign-in via `USER_AUTH`.
- Local-format phone normalization (needs a country from the client).
- Adding a second identifier to an existing account.
