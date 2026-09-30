# 2026-09-26 — delete user API (soft delete)

## `DELETE /users/me`

The caller deletes their own account. **Soft delete**: the user document
gets a `deletedAt` timestamp and nothing is destroyed — reversible by
clearing the field by hand (no restore API yet).

## Pre-flight guard — owned groups

Blocked with **400** while the caller still owns groups, naming them:

> You still own 2 group(s): 'Second FC', 'Aura Bangkok'. Delete each group
> or transfer ownership before deleting your account.

A rejected request changes nothing. Mobile should surface this and route
the user to their groups.

## What deletion does

1. **Cancels the unfinished events they organize** — through the normal
   cancellation flow: status `cancelled`, reason **"Organizer account
   deleted"** visible to players, chats archived, roster notified.
   Finished events stay as history.
2. **Leaves rosters still open for joining** — their player rows on other
   people's `join`-status events are cancelled via the normal leave flow
   (headcount corrected, their guests cascade out). Events already past
   `join` keep the roster row: teams and fixtures reference it, the same
   reason a player cannot self-leave at that stage.
3. **Flags the account** — `deletedAt` is stamped last, so any failure
   above leaves a fully working account.

## What "deleted" means afterwards

- **Every existing token stops working** — the JWT strategy rejects the
  account per request (Cognito access tokens are stateless, so this check
  is the actual revocation): 401 "This account has been deleted".
- **Login fails the same way** — checked after Cognito verifies the
  password, so the endpoint cannot be used to probe which emails exist.
- **`GET /users/:id/profile`** answers 404 exactly like a missing user;
  **`GET /users/search`** excludes the account.
- **Shared history survives** for other members: chat messages, payments,
  ratings, finished events and standings are untouched.

## Known consequences

- The email stays reserved in Mongo **and Cognito** — re-signup with the
  same address is a 409 until the account is restored by hand
  (clear `deletedAt`; the Cognito user was never touched).
- Group member lists still contain the account (soft delete keeps
  memberships). Say the word if deleted members should be hidden there too.

## Not included (by design)

Hard/GDPR erasure, an admin delete endpoint, and a restore endpoint — all
straightforward to add on top of the flag later.

## Deploy

No new steps: no seeder, no env change, no migration (missing `deletedAt`
reads as null).
