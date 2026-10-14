# 2026-10-14 — anonymous players on public events

A person with NO account can join a PUBLIC event under just a name.
Guests (sponsored plus-ones with the approval flow) are unchanged.

## `POST /events/:id/join-anonymous` — public, no token

```json
{ "name": "Aung Aung" }
```

Response:

```json
{
  "message": "Joined event successfully",
  "playerId": "68ff01…",
  "name": "Aung Aung"
}
```

- The event must be PUBLIC (400 otherwise — challenge events are private
  by construction, so they are covered), in `join`, and under
  `maxPlayers`; the capacity check is the same atomic guard as a normal
  join, so two walk-ins cannot both take the last slot.
- The roster row is `type: "anonymous"` with `guestName` set — no userId,
  no sponsor, no approval step (the event being public IS the
  invitation). Same name may join twice; there is no identity to dedupe.
- `playerId` is the only handle the player has — the device can keep it.

## `DELETE /events/:id/anonymous/:playerId` — organizer

The only exit an anonymous row has (an accountless player cannot
authenticate a self-leave). Cancels the row and frees the slot.

## Where anonymous players appear

- `GET /events/:id/players` — listed with `type: "anonymous"` and
  `guestName`; branch on `type` as with guests.
- Teams & shuffle: they travel the GUEST rails — dealt into
  `team.guests` by roster-row id, count toward the shuffle minimum, and
  are placeable in formations (resolved by `guestName`, `isGuest: true`).

## Also fixed in passing

Formation reads resolved guest names from a field that does not exist
(`name` instead of `guestName`) — guest slots always came back
`name: null`. Now resolved correctly for guests and anonymous players.

No deploy steps; existing rows are unaffected.
