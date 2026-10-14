# 2026-10-14 — public detail APIs for group and event

Both detail endpoints are now PUBLICLY accessible — no token, no
membership, no private/public narrowing:

- `GET /events/:id` — full detail (group header, rules, location, teams,
  matches, standings) for ANY event, private ones included.
- `GET /groups/:id` — the FULL group document for any group, private ones
  included. The old non-member narrowing (card fields + rules only) is
  gone.

Auth is OPTIONAL, not absent: send a valid token and the caller-specific
flags still light up (`userRole`, `memberStatus`, `isCashier`,
`joinedByMe`, `likedByMe`, admin-only challenge proposal fields).
Anonymous callers get null/false for those — one response shape for
everyone. An invalid or missing token is simply treated as anonymous,
never a 401.

## The one surviving exception

`inviteCode` / `inviteCodeExpiry` are still stripped from the group
detail for anyone but an APPROVED member — a credential rule, not a
privacy rule: the code is a bearer token that `POST /groups/join-by-code`
accepts from whoever presents it, so a public page must not hand it out.
Members read it from `GET /groups/:id/qr` as before. This gate is now
membership-based even for public groups.

## Implementation note

The two routes moved to guard-less controllers (`PublicEventsController`,
`PublicGroupsController`) using a new `OptionalJwtAuthGuard`, registered
after the guarded controllers so static routes (`/events/search`,
`/groups/search`, …) keep priority. Every other route still requires a
token.
