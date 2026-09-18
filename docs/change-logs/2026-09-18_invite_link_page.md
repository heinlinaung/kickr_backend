# 2026-09-18 — invite link landing page (`GET /g/:code`)

## The bug

`GET /groups/:id/qr` returns `inviteLink: "{APP_BASE_URL}/g/{code}"`, and the
QR encodes that URL — but nothing ever served `/g/:code`. Scanning the QR with
a phone camera (or opening the link in any browser) hit the API and got:

```json
{"statusCode":404, "path":"/g/<code>", "message":"Cannot GET /g/<code>", "error":"Not Found"}
```

## The fix

New public route **`GET /g/:code`** (`InviteLinkController`, GroupsModule):

- **No auth** — uniquely for this API. The link is opened from a camera scan
  by someone with no session. Safe because the page only PRESENTS the invite;
  joining still happens in the app via `POST /invitations/groups/join-by-code`,
  which creates a pending request an owner/admin must approve.
- **Browsers get HTML**: a small self-contained landing page with the group's
  logo, name and description, the invite code (selectable for copy), and
  instructions to join through the app. Group name/description are
  HTML-escaped — they are user content.
- **`Accept: application/json` gets JSON** (hand-wrapped in the API's usual
  `{ data }` envelope): `{ code, group: { _id, name, description, logo,
  sportType, isPrivate } }` — a preview the mobile app can render before
  calling join-by-code.
- **Unknown or expired code → 404** either way (friendly HTML page, or
  `{"statusCode":404,"message":"Invalid or expired invite code"}`).

Validity deliberately mirrors `joinByCode`: the code must exist **and** its
expiry must be strictly in the future (`inviteCodeExpiry > now`), so the page
never presents a code redemption would then refuse. The lookup
(`GroupsService.resolveInviteCode`) selects only public card fields — never
invite internals.

## Config

`APP_BASE_URL` must be the **publicly reachable** API address in every
deployed environment (e.g. `http://168.144.44.156`), because it is the base
the QR link is minted from. `.env.example` now documents this; localhost only
works for a phone on the same machine.
