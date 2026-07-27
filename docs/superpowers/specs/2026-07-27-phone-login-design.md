# Phone Number Sign-In — Design

**Status:** Proposed (not implemented)
**Date:** 2026-07-27
**Related:** [2026-07-27-phone-login-plan.md](../plans/2026-07-27-phone-login-plan.md) · [2026-07-27-email-change-verification-design.md](./2026-07-27-email-change-verification-design.md)

---

## Problem

Users should be able to sign up and sign in with **either** an email address or
a phone number. Phone is an *additional* option, not a replacement — email
signup/login stays exactly as it is today.

The infrastructure is already in place. Pool `KickR-v3`
(`ap-southeast-1_7dkdUTpj1`) was created with:

```json
{
  "UsernameAttributes": ["email", "phone_number"],
  "AutoVerifiedAttributes": ["email", "phone_number"],
  "SmsConfiguration": { "SnsCallerArn": "…/CognitoIdpSNSServiceRole", "SnsRegion": "ap-southeast-1" },
  "LambdaConfig": { "PreSignUp": "…:cognito-pre-sign-up-auto-confirmed" },
  "SchemaAttributes.phone_number": { "Mutable": true, "Required": false }
}
```

The **backend** is what blocks it. Verified against the running API on v3:

```
POST /auth/signup {"email":"+6581234567","password":"…"}
→ 400 ["email must be an email"]

POST /auth/signup {"phoneNumber":"+6581234567","password":"…"}
→ 400 ["property phoneNumber should not exist", "email must be an email"]
```

`@IsEmail()` rejects the phone number, and the whitelist pipe strips any field
the DTO does not declare. So this is purely an application-layer change.

## Non-goals

- **Migrating existing users.** Everyone on v3 signed up with email and keeps
  doing so. No back-fill of phone numbers.
- **Replacing email login.** Both identifiers work, independently.
- **SMS MFA.** `MfaConfiguration: "OFF"`. Second-factor SMS is a different
  feature from phone-as-identity and is out of scope.
- **Passwordless / OTP sign-in.** `USER_AUTH` is enabled on the client but this
  design keeps password authentication for both identifier types. Passwordless
  is a separate decision.
- **Changing your phone number after signup.** Same shape as the email-change
  problem; see that design doc. Deliberately deferred.

---

## The core design decision: one field or two?

The signup/login DTOs need to accept an identifier that may be an email **or**
a phone number. Two shapes were considered.

### Rejected: a discriminated `{ identifierType, identifier }` pair

Explicit, but pushes classification onto the client, and a client that
mislabels its own input produces a confusing failure deep in Cognito. It also
makes the mobile app's job harder for no benefit — the app has the raw string
and would have to classify it anyway.

### Chosen: a single `identifier` field, classified server-side

```
POST /auth/signup  { identifier: "user@example.com" | "+6581234567", password }
POST /auth/login   { identifier: "…", password }
```

The server decides what it received. One code path, one validator, and the
client sends exactly what the user typed. This mirrors how the login screen
actually works — a single input box.

**Backward compatibility is a hard requirement.** The Flutter client currently
sends `email`. Breaking it again — right after the `username` → `email`
migration — is not acceptable. So both DTOs accept `email` **or** `identifier`,
with `email` retained as a deprecated alias that continues to work unchanged.
This is stated as a requirement, not an implementation detail: a change that
breaks the existing client is a failed change.

## Classification rule

A value is a **phone number** if it matches E.164 (`^\+[1-9]\d{1,14}$`),
otherwise it is treated as an **email** and validated with `@IsEmail()`.

E.164 is the correct discriminator because Cognito requires that exact format
for `phone_number` — it rejects anything else outright. The leading `+` makes
the two identifier spaces unambiguous: no valid email starts with `+` in the
position E.164 requires it, and no valid E.164 number contains `@`.

**Local formats are rejected.** `0812345678` (Singapore/Thai local style) is
*not* accepted and must be sent as `+6581234567`. Normalizing local numbers
requires knowing the user's country, which the signup form does not collect;
guessing would silently create accounts under the wrong country code. The
client is responsible for composing E.164 from its country picker.

`class-validator` ships `@IsPhoneNumber()`, which is available in the installed
version — but the plan uses an explicit E.164 regex, because `@IsPhoneNumber()`
accepts national formats when given a region and is more permissive than
Cognito. Matching Cognito's own constraint exactly is the safer choice.

## Normalization

| Identifier | Rule |
|---|---|
| Email | lowercased, as today (`AuthService` + schema `lowercase: true`) |
| Phone | already canonical if valid E.164; strip incidental whitespace only |

Phone numbers are **not** case-folded or otherwise rewritten. E.164 is already
a canonical form, and rewriting risks changing the number.

---

## Cognito interaction

The good news: `CognitoService` needs almost no change. Every method already
sends whatever identifier it is given as `Username` and computes `SECRET_HASH`
over that same value. Because v3 lists both attributes in `UsernameAttributes`,
Cognito accepts either as the sign-in identity, and the existing
`ADMIN_USER_PASSWORD_AUTH` flow works unchanged.

The one place that differs is **signup**, which currently hard-codes the email
attribute:

```ts
UserAttributes: [{ Name: 'email', Value: email }]
```

This must become conditional — `email` for an email signup, `phone_number` for
a phone signup. Setting the wrong attribute creates a user whose sign-in alias
does not match what they typed.

### The `sub`-as-Username trap (again)

`refresh()` must keep hashing the **`sub`**, not the identifier. This is the
bug that shipped in `bbe1927`: `REFRESH_TOKEN_AUTH` requires `SECRET_HASH` over
the user's real Cognito username, which for an alias-based pool is the internal
UUID. It is identifier-agnostic and therefore **unaffected** by this change —
but any refactor that "unifies" the hashing must not break it. The regression
test added in `bbe1927` guards this.

Similarly, admin commands (`AdminGetUser`, `AdminUpdateUserAttributes`) take the
`sub` as `Username`, not the email or phone.

---

## Data model

`User.phoneNumber` already exists (`@Prop() phoneNumber: string`) but is
**unconstrained**: no unique index, no verification flag. It must become a
first-class identity field, mirroring `email`:

| Field | Current | Required |
|---|---|---|
| `email` | `required, unique, lowercase` | unchanged |
| `phoneNumber` | plain `@Prop()` | `unique, sparse` |
| `phoneVerified` | does not exist | new, `default: false` |

`sparse` is essential — most users will have no phone number, and a non-sparse
unique index would reject every user after the first `null`.

**`email` must become optional.** It is currently `required: true`, which makes
a phone-only signup impossible. The invariant becomes: *at least one of `email`
or `phoneNumber` must be present*, enforced at the service layer (Mongoose
cannot express a cross-field requirement declaratively).

Verified state of the collection (2026-07-27): indexes exist on `username`
(unique sparse), `email` (unique), `inviteCode` (unique sparse), and
`cognitoSub` (unique). **Zero documents currently have `phoneNumber` set**, so
the new unique index can be built with no duplicate-key conflicts and no
back-fill.

### `name` seeding

Signup seeds `name` from the email's local part
(`defaultNameFromEmail`, added in `cf8a974`). For a phone signup there is no
local part. The seed becomes the E.164 string itself (`+6581234567`), which is
displayable and unique-ish, and the user renames themselves via
`PATCH /users/me` — same as the email case.

---

## ⚠️ Security finding: `phoneNumber` is currently client-settable

**This must be fixed as part of this feature, and it is the most important
item in this document.**

`UpdateProfileDto` declares `phoneNumber?: string` as a freely editable profile
field, and `updateProfile` does `$set: dto` with a uniqueness pre-check for
`username` **only**. Today that is harmless — phone is just display data.

The moment phone becomes a **sign-in identity**, it becomes an account-takeover
primitive of exactly the kind described in the email-change design:

1. Attacker signs up with any email.
2. `PATCH /users/me { "phoneNumber": "+65<victim's number>" }` — no uniqueness
   check, no verification, no SMS sent.
3. The attacker's Mongo profile now claims the victim's phone number.

Whether this yields a full takeover depends on how the Mongo lookup is written,
but it is unambiguously wrong to let an unverified, unchecked `PATCH` write a
field that identifies an account.

**Required mitigation:** remove `phoneNumber` from `UpdateProfileDto`. Like
`email`, it stops being a profile field and becomes identity, changeable only
through a verified flow. Since no user currently has one set, nothing is lost.

Adding a verified *phone change* flow (SMS code to the new number, write only
after verification) is the mirror of the email-change design and is deferred to
that work — but the **removal from the DTO must ship with this feature**, not
after it.

---

## Login lookup

`AuthService.login` currently does `findOne({ email })`. It must branch:

```
phone identifier → findOne({ phoneNumber: identifier })
email identifier → findOne({ email: identifier.toLowerCase() })
```

A single `$or` query across both fields is **rejected**: it would let a value
stored in one field match a login attempt of the other type, blurring the two
identity spaces. Classification is already unambiguous, so branching is both
safer and clearer.

## Error mapping

`mapCognitoError` needs one addition. `UsernameExistsException` currently maps
to *"Username already registered"*, which is now misleading — the message
should reflect which identifier collided. The mapping stays 409; only the
message becomes identifier-aware, resolved at the call site where the type is
known.

`AliasExistsException` (noted as unmapped in the email-change design) becomes
more likely here, since v3 has two alias attributes. It must map to **409**.

## SMS deliverability — the real-world blocker

`SmsConfiguration` is present on v3 with an SNS caller role, so Cognito is
wired to send. Two operational caveats that are not code problems but will
block testing:

1. **SNS sandbox.** A new account is sandboxed and can only send SMS to
   *verified* destination numbers. Until AWS grants production SMS access,
   phone signup only works for numbers explicitly registered in SNS. This is
   typically the long pole in shipping phone auth.
2. **Spend limits and per-country rules.** Some destinations require sender-ID
   registration. Singapore in particular has registration requirements.

Neither affects the code, but Task 0 in the plan checks sandbox status first —
there is no point building the flow if codes cannot be delivered to a test
handset.

Note also that with the pre-sign-up Lambda auto-confirming, a phone signup is
confirmed **without** an SMS being sent at all. That means phone numbers, like
emails today, are *unverified by default* — the same gap the email-change
design flags. It is acceptable for signup, but it means `phoneVerified` should
be treated as "not proven" until a real verification flow exists.

---

## Security boundary (must hold)

- `phoneNumber` and `phoneVerified` **must not** appear in `UpdateProfileDto`
  (see the finding above). Same rule as `email`/`emailVerified`.
- Classification happens **server-side**; the client never declares the type.
- The Mongo lookup branches on identifier type — never `$or` across both.
- `refresh()` keeps hashing the `sub`, never the identifier.
- Phone-signup users must not be able to collide with an existing phone number:
  enforced by the unique sparse index **and** a service pre-check, mirroring the
  two-store uniqueness argument in the email-change design.
- Existing `email`-field clients keep working unchanged.

## Open questions for product

1. **Should a user be able to have both?** This design allows it (an account
   can carry an email and a phone, either usable for sign-in) but provides no
   flow to *add* the second one after signup. That needs the verified-change
   work.
2. **Password reset for phone users.** `AccountRecoverySetting` lists
   `verified_email` (priority 1) then `verified_phone_number` (priority 2). A
   phone-only user has no email, so recovery must go over SMS — worth an
   explicit test, since the existing `forgot-password` endpoint assumes email.
3. **Which countries?** Affects SNS registration and sender-ID work.
