# Verified Email Change — Design

**Status:** Proposed (not implemented)
**Date:** 2026-07-27
**Related:** [2026-07-27-email-change-verification-plan.md](../plans/2026-07-27-email-change-verification-plan.md)

---

## Problem

The KickR-v2 pool signs users in by **email**, and a pre-sign-up Lambda
(`cognito-pre-sign-up-auto-confirmed`) auto-confirms every registration. Two
consequences follow:

1. **Nobody proves they own the address they register with.** A user can sign
   up as `someone-elses@email.com` and the Lambda marks it
   `email_verified: true` without a single email being sent.
2. **That address is permanent.** `UpdateProfileDto` has no `email` field, and
   the global `ValidationPipe({ whitelist: true })` strips unknown properties,
   so `PATCH /users/me` silently discards any attempt to change it.

So a user who typos their address at signup — or deliberately registers with a
throwaway — is stranded on it forever, and an address belonging to a real third
party can sit in the system marked "verified".

This document specifies a flow that lets a user move to an address they
actually control, while proving ownership in the process.

## Non-goals

- **Retroactively verifying existing accounts.** Every account created to date
  is `email_verified: true` without proof. Back-filling that (e.g. forcing a
  re-verification sweep) is a separate migration, not this change.
- **Removing the auto-confirm Lambda.** Signup stays frictionless. This
  document only adds a verified path for *changing* an address.
- **Changing sign-in identity to something other than email.** Out of scope.

---

## Why this cannot be a profile field

The obvious implementation — add `email` to `UpdateProfileDto` — is wrong in
two independent ways, and both are worth stating so nobody "simplifies" the
design back into them later.

**1. It would write the wrong database.** Cognito owns identity; Mongo owns the
profile. `updateProfile` does `$set: dto`, which touches Mongo only. The user's
Cognito record — and therefore the address they actually *sign in* with —
would be unchanged. The two stores would silently diverge, and the user would
log in with the old address while the app displayed the new one.

**2. It would be an account-takeover primitive.** With auto-confirm on, an
unverified `PATCH` to `email` lets any user claim any address. Register with a
throwaway, change to `victim@bank.com`, and you now hold an account that the
system labels as that person's verified address. The moment anything downstream
trusts email for identity — password reset already mails a code there — that
becomes a real compromise.

Ownership must therefore be proven **against the new address, before the change
takes effect anywhere**.

## Why the auto-confirm Lambda does not defeat this

The pre-sign-up Lambda triggers on **sign-up only**. It has no bearing on
attribute-change verification, which is a different Cognito code path
(`GetUserAttributeVerificationCode` / `VerifyUserAttribute`). A verification
code sent for an email *change* is genuinely delivered to the new address and
genuinely must be echoed back. Auto-confirm at signup and verified email change
coexist without conflict.

---

## Required pool configuration change

This is a prerequisite, not an implementation detail. **The flow is unsafe
without it.**

Current state of pool `ap-southeast-1_8NpoRlnZe` (verified 2026-07-27):

```json
{
  "UserAttributeUpdateSettings": { "AttributesRequireVerificationBeforeUpdate": [] },
  "AutoVerifiedAttributes": ["email"],
  "UsernameAttributes": ["email"],
  "SchemaAttributes.email": { "Mutable": true, "Required": false }
}
```

`AttributesRequireVerificationBeforeUpdate` is **empty**. With that setting
empty, calling `AdminUpdateUserAttributes` to set a new email switches the
sign-in address *immediately*, before verification. Two failure modes follow
directly:

- **Typo lockout.** A user who mistypes the new address is instantly unable to
  sign in — their identity moved to a mailbox that does not exist, and they
  cannot receive the code that would fix it.
- **Unverified identity.** Between request and verification, the account's
  login identity is an address nobody has proven they own.

Setting it to `["email"]` makes Cognito keep the **original** email active for
sign-in until the new one is verified, and stage the new value as
`email_verified: false` in the meantime. This is precisely the behavior the
flow needs.

```bash
aws cognito-idp update-user-pool \
  --user-pool-id ap-southeast-1_8NpoRlnZe \
  --region ap-southeast-1 \
  --user-pool-add-ons ... \
  --user-attribute-update-settings AttributesRequireVerificationBeforeUpdate=email
```

> ⚠️ `update-user-pool` **replaces** the whole pool config. Any parameter not
> passed reverts to its default — including `LambdaConfig`, which would
> silently detach the auto-confirm Lambda. Read the current config first and
> pass every field back, or make the change in the console. This is the single
> riskiest step in the whole plan; see Task 0 in the implementation plan.

`email` is already `Mutable: true`, so no schema change is needed.

---

## Flow

Two endpoints, both authenticated. The Mongo write happens **only** after
Cognito confirms verification.

```
┌────────────────────────── request ──────────────────────────┐
│ POST /users/me/email        { newEmail }                    │
│   ├─ 409 if newEmail already belongs to another account     │
│   ├─ AdminUpdateUserAttributes → email=new, verified=false  │
│   │    (pool setting keeps OLD email valid for sign-in)     │
│   └─ GetUserAttributeVerificationCode → code sent to NEW    │
│      Mongo: UNCHANGED                                       │
└─────────────────────────────────────────────────────────────┘
┌────────────────────────── confirm ──────────────────────────┐
│ POST /users/me/email/verify { code }                        │
│   ├─ VerifyUserAttribute(accessToken, 'email', code)        │
│   │    Cognito promotes new email, sets verified=true,      │
│   │    sign-in identity moves to the new address            │
│   └─ Mongo: users.email = newEmail, emailVerified = true    │
└─────────────────────────────────────────────────────────────┘
```

### Why the access token is required

`GetUserAttributeVerificationCode` and `VerifyUserAttribute` are **user-pool
APIs, not admin APIs** — they authenticate with the caller's *access token*,
not IAM credentials. This matters because the codebase does not currently
surface the raw token to services:

`CurrentUser` (`src/common/decorators/current-user.decorator.ts`) returns
`request.user`, which `JwtStrategy.validate()` populates with the **Mongo
document**. The bearer token itself is discarded after verification.

The implementation therefore needs a small addition — either a `@AccessToken()`
param decorator reading `Authorization` off the request, or having
`JwtStrategy` attach the raw token to the returned user object. The plan uses a
dedicated decorator, since widening the user object risks the token leaking
into a response body.

### Sequencing: why verify-then-write, never write-then-verify

Mongo is updated only in step 2, after `VerifyUserAttribute` returns
successfully. If the process dies between Cognito verifying and Mongo writing,
the result is a *recoverable* inconsistency: Cognito has the new address, Mongo
has the old one, and the user can still sign in (Cognito is the sign-in
authority). A reconciliation read on next login fixes it.

The reverse order — writing Mongo first — produces an *unrecoverable* one: the
profile claims an address the user may never verify.

---

## Error mapping

`mapCognitoError` (`src/auth/cognito/cognito.errors.ts`) already handles
`CodeMismatchException` and `ExpiredCodeException` → 400 "Invalid or expired
code", and `LimitExceededException`/`TooManyRequestsException` → 503, which
covers code brute-forcing.

**One case is missing.** When the requested email already exists as another
user's sign-in alias, Cognito raises `AliasExistsException`, which is not in
the switch and would fall through to `default:` → a generic 400 echoing the raw
AWS message. It must map to **409 Conflict** to match the duplicate-username
behavior.

| Condition | Cognito exception | HTTP |
|---|---|---|
| New email already taken (Cognito) | `AliasExistsException` | 409 |
| New email already taken (Mongo) | Mongo `code: 11000` | 409 |
| Wrong or expired code | `CodeMismatch` / `ExpiredCode` | 400 |
| Too many attempts | `LimitExceeded` / `TooManyRequests` | 503 |
| New email equals current | — (guard in service) | 400 |

## Uniqueness

Enforced in **two** places, and both must be checked:

- **Mongo** — `email` is `required: true, unique: true, lowercase: true` on the
  `User` schema.
- **Cognito** — `UsernameAttributes: ["email"]` makes email the sign-in alias,
  so the pool rejects duplicates itself.

The service pre-checks Mongo (cheap, gives a clean 409 before any AWS call) and
still maps `AliasExistsException`, because the two stores can disagree — a
Cognito user whose Mongo profile creation failed during the signup dual-write
would be invisible to the Mongo check.

## Normalization

Emails are lowercased before every Cognito and Mongo operation, matching the
existing auth flows (`AuthService.signup`/`login`) and the schema's
`lowercase: true`. The new endpoints follow the same rule so
`User@Example.com` and `user@example.com` cannot become distinct accounts.

## Identity stability

`cognitoSub` is unaffected. It is the immutable join key between Cognito and
Mongo (`JwtStrategy` and `ChatGateway` both resolve users by it), so an email
change is a column update — group memberships, event history, and chat
messages all survive it. This is the reason the schema keys on `sub` rather
than email, and this feature is the concrete case that justifies it.

## Rate limiting

Cognito enforces its own throttling on verification-code requests
(`LimitExceededException`, already mapped to 503). No application-level limiter
is specified here; if abuse of `POST /users/me/email` becomes a concern, that
is a follow-up and should be applied at the same layer as any other endpoint
throttling rather than special-cased.

---

## Security boundary (must hold)

- `email` and `emailVerified` **must never** be added to `UpdateProfileDto`.
  The DTO is the write-whitelist for `$set: dto`; adding them there reintroduces
  the unverified-change hole this design exists to prevent.
- The Mongo `email` write happens **only** in the verify handler, after
  `VerifyUserAttribute` succeeds — never in the request handler.
- Both endpoints are authenticated and operate **only** on the caller's own
  account, derived from the JWT. Neither accepts a target user id.
- The access token must not leak into any response body.
- `emailVerified` in Mongo is set from the *verified* outcome, not from client
  input.

## Open questions for product

1. **Should the old address be notified?** Standard practice is to email the
   previous address when a change is requested, so an account takeover is
   visible to the rightful owner. Not specified above; requires a mail path
   the backend does not currently own.
2. **Should existing unverified-by-Lambda accounts be swept?** See non-goals.
3. **Cooldown between changes?** Not specified; Cognito throttling only.
