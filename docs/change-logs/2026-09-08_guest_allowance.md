# Change Log — 2026-09-08 · Guest allowance: owner/admin uncapped

**Branch:** `events-feature-spec`
**Tests:** 1029 passing across 50 suites · build clean
**Verified:** unit, plus **the index diagnosis confirmed against the live
database** — it was the stale plain unique index, and the repair script fixed
it. §2.

Two separate things: a reported bug that is **not** in the application code, and
a feature that genuinely did not exist.

---

## 1. "Only allows one guest player" — not the application cap

Verified first, because the report and the code disagreed.

`MAX_GUESTS_PER_MEMBER` is **2**, not 1, and `addGuest` refuses only when
`alreadyBrought >= 2`. New tests pin the boundary directly — first guest
allowed, **second allowed**, third refused — and they pass.

So the cap is not what blocks the second guest.

## 2. It WAS the database index — confirmed and fixed

The schema declares:

```ts
EventPlayerSchema.index(
  { eventId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $exists: true } } },
);
```

Guests carry **no `userId`**. That partial filter is the only thing keeping them
out of the uniqueness rule.

**Mongoose only creates an index it does not already find.** It will not alter
one whose keys match. So a database still holding the older *plain* unique index
on `{eventId, userId}` — from before guests existed — keeps it, every guest row
collides on `(eventId, null)`, and **only the first guest on an event can ever
insert.** Which is exactly the report.

This was flagged when guests were built, in
`2026-08-31_guest_players.md`:

> *"If that index is wrong, the second guest on any event fails to insert — the
> highest-consequence unverified item in this change."*

It was never checked against a real database. It should have been.

**Confirmed 2026-09-08:** the owner ran the script against the live database,
it found the stale plain unique index, and `--apply` repaired it. A second guest
now inserts. The reasoning below held exactly.

### Diagnose and repair

`scripts/fix-event-player-index.ts` — report-only by default, like every other
script in `scripts/`:

```bash
# report: lists every index on eventplayers and names the offender
npx ts-node scripts/fix-event-player-index.ts

# repair: drop the plain unique index, build the partial one
npx ts-node scripts/fix-event-player-index.ts --apply
```

It prints the target URI with credentials redacted, counts the guest rows
affected so the impact is concrete, and **rebuilds the index in the same run**
rather than leaving it to the next boot — between a drop and a restart there
would be no uniqueness rule at all, and a duplicate registered player could slip
in.

If it reports the index is already correct, the index is not the cause and
something else is; say so rather than assuming.

## 3. The feature that did not exist

> *"Admin/Owner can add as many guests as needed. Other roles can only add up to
> 2."*

`addGuest` applied the same flat cap of 2 to **everyone** — no role check at
all. Now a group **owner** or **admin** has no allowance cap.

Two boundaries, both chosen deliberately rather than assumed:

**Which roles.** `owner` and `admin` only, and the membership must be
**approved**. This is **narrower than `assertOrganizer`**, which also accepts
the event's creator — creating an event is not a position of trust in the group,
so anyone able to create one would otherwise self-grant an unlimited allowance.
The two checks differ on purpose, and the code says so at the call site.

**What bounds them.** Nothing. "Up to the maximum player limit" was the original
wording, but `maxPlayers` is a **soft** limit for guests everywhere else on this
branch — an approved guest may push the roster past it, by earlier decision — so
binding it only here would contradict that. Put to the owner; uncapped was
chosen.

The allowance query is **skipped entirely** for a manager, not merely ignored:
one fewer round trip on the path that will add the most guests.

## 4. A test that would have passed while proving nothing

The shared event double in the guest spec has `groupId: null`, which
short-circuits the manager lookup before it runs. Every new test would have
passed while exercising **none** of the new code.

Caught because the first version of one assertion failed for the wrong reason,
which prompted a look at what was actually being called. The manager tests now
build their own group event, and the spec says why in a comment.

That failing assertion was also a real finding, not just noise: it caught the
guest-name sequence lookup, which also filters on `addedByUserId` and is still
needed for a manager. The assertion was tightened to exclude it rather than the
code being changed.

**This is the fifth time on this branch** a mock that did not match the real
shape hid a change.

## 5. Tests

**5 cap-boundary cases:** first guest allowed; **second allowed** (the reported
failure — if this passes and the API still refuses, the index is the cause);
third refused; the count is scoped to this sponsor; rejected guests do not burn
the allowance.

**5 manager cases:** an owner/admin gets past the limit; their existing guests
are not even counted; an ordinary member of the same group is still capped; the
membership check requires `approved` and `role ∈ {owner, admin}`; and the
creator of a groupless event is still capped.

**Verified by reverting:** disabling the exemption fails 2 of the 5 manager
tests. Restored, all 53 in the spec pass.

## 6. What is NOT verified

- ~~**The index diagnosis.**~~ **Confirmed on the live database 2026-09-08.**
  The stale plain unique index was present; the script dropped it and built the
  partial one, and a second guest now inserts.
- **The raised allowance against real data.** `memberModel.exists` is mocked, so
  no owner/admin has actually added a third guest.
- **Whether uncapped guests break anything downstream.** Shuffle and team
  generation size themselves off the roster, so a large guest count should flow
  through — but no one has tried an event with, say, 20 guests.
