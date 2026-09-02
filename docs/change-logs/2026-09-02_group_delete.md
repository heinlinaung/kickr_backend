# Change Log — 2026-09-02 · `DELETE /groups/:id`

**Branch:** `events-feature-spec`
**Tests:** 853 passing across 40 suites · build clean
**Verified:** unit only. §5 explains why that matters more than usual here.

Closes the "group delete" half of the long-standing
**Ownership transfer / group delete** gap. Ownership transfer is still missing.

---

## 1. Owner only, and deliberately narrower than everything else

Every other management route in `GroupsService` is gated by
`assertOwnerOrAdmin`. This one checks `group.ownerId` directly, so **an admin
gets `403`**.

An admin can be appointed and removed by an owner. Handing them the power to
destroy the group's entire history — every event, score and message — is a
different order of trust from letting them edit its rules or approve a member.
Narrowing later would be a breaking change; widening it is a one-line edit if
this proves too strict.

## 2. The cascade, and who owns it

Two decisions were put to the owner before building, because both had a
defensible "refuse instead" answer:

| Question | Decision |
|---|---|
| A group's events? | **Cascade** — delete them and everything under them |
| Group-owned locations? | **Delete** them with the group |
| Tournaments? | **Leave untouched** — module still being designed (§2.1) |

**Eleven collections are cleared**, across two passes. Leaving any would strand
rows pointing at an id that no longer resolves, and every read would then have
to tolerate a dangling group.

*(An earlier draft of this entry said "seven". That was the count of collections
carrying a `groupId`, not the size of the cascade — it missed the five that hang
off an event, and counted `tournaments`, which is now deliberately excluded, and
`test-run`, which is admin seeding metadata and correctly untouched.)*

**Events go first, and through `EventsService.removeAllForGroup`.** That method
is new, and lives in the events module rather than here on purpose: each event
owns players, guests, fixtures, teams, chats, likes and payments. A group has no
business knowing that list, and duplicating it in `GroupsService` would
guarantee the two drift as event sub-collections are added — this branch alone
added three.

`removeAllForGroup` deliberately takes **no permission argument**. Authorisation
is the caller's job: ownership is already established, and re-deriving organizer
rights per event would be both wasteful and wrong, since a group owner may
delete an event they did not create. It also ignores the `done` guard that
protects `EventsService.remove` — that check stops an organizer destroying a
finished event by accident, whereas here the owner has explicitly asked for the
whole group to go, archives included.

### 2.1 Tournaments are deliberately not cascaded

The tournament module has no settled design yet, so cascading into it would bake
in assumptions about a schema still in flux.

They are **not merely skipped but deliberately untouched**, and that distinction
is the whole point: deleting `tournaments` by `groupId` while leaving
`TournamentTeam` and `TournamentMatch` behind would be **worse than doing
nothing**. Those rows key only on `tournamentId`, so once the parent is gone
nothing can find them again — a half-cascade manufactures unreachable data,
where no cascade merely leaves a dangling `groupId` that is still queryable.

The first version of this route did exactly that half-cascade. It was caught by
auditing the actual delete calls against the collections that reference a group,
which is also what corrected the "seven" figure above.

Any tournaments are therefore **counted, not deleted**, and reported as
`orphanedTournaments` outside the `deleted` block so the number cannot be
mistaken for a removal count. Revisit when the tournament design lands.

### The module wiring, and the cycle avoided

`GroupsModule` now imports `EventsModule`. That direction is safe —
`EventsModule` does not import `GroupsModule`, it registers the `Group` schema
directly.

`Message`, `Tournament` and `Location` are registered as **schemas** in
`GroupsModule` rather than reached through their own modules, because
**`ChatModule` imports `GroupsModule`** and `TournamentsModule` would likely
follow. Importing them back would be a genuine circular module dependency. A
schema carries no dependencies of its own, so registering it twice is safe where
importing the module is not.

## 3. The response reports the blast radius

```json
{ "message": "Group deleted successfully",
  "deleted": { "events": 3, "members": 27, "messages": 412,
               "locations": 2 },
  "orphanedTournaments": 0 }
```

Counts rather than a bare message, because this is irreversible: there is no
soft delete, archive or undo anywhere in this codebase. Inventing one for this
route alone would leave a second kind of "deleted" for every other read to
learn about, so the alternative to a hard delete was not building the route.

The client should show those numbers **before** the call as a confirmation
(`GET /groups/:id` and `GET /events/group/:groupId` supply them) and **after**
as a receipt.

## 4. The dangling reference we accepted

Deleting locations rather than orphaning them has one sharp edge, and it is
worth stating rather than discovering:

**An event outside this group that had adopted one of its venues keeps a
`locationId` that no longer resolves.** `GET /events/:id` will report a null
location for it. Nothing crashes, but that event has silently lost its ground.

The alternative — `groupId: null`, handing venues back as the owner's personal
locations — would have avoided this, since a venue is a real place that outlives
the group. The decision was a clean teardown, so this is the cost.

## 5. Testing, and why unit-only is thin here

13 new tests: every collection cleared by `groupId`; events delegated to
`EventsService` rather than swept locally; ordering (events strictly before the
group); the counts returned; and `403` for an admin, `403` for a non-member,
`404` for an unknown group with nothing deleted first.

**A mocked cascade proves the calls are made, not that they delete the right
rows.** That gap is wider than usual for this route, because the failure mode is
not an exception — it is data quietly surviving or quietly vanishing:

- A wrong filter on any of the `deleteMany` calls either leaves orphans or
  **deletes another group's rows**. A mock cannot tell those apart.
- The `Promise.all` over three deletes is not a transaction. A mid-flight failure
  leaves the group deleted or half-deleted with no rollback, and nothing here
  exercises that.

Worth one run against real data before this is used on anything but test data:
create a group with an event and a location, delete it, then confirm the event's
fixtures and roster rows are gone and that a *second* group's rows are untouched.
