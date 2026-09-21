# 2026-09-21 — GET /events: group members see their groups' private events

## The bug

A private event (`isPublic: false`) of a group the caller belongs to appeared
in `GET /events/group/:groupId` (membership-gated) but was missing from
`GET /events` until the caller had **joined** that specific event. Discovery
visibility had only two routes in:

```js
{ $or: [{ isPublic: true }, { _id: { $in: joinedEventIds } }] }
```

So of two identical private events in the same group, the one the caller had
joined showed up and the other silently didn't — backwards for a discovery
list, whose whole job is showing events you have NOT joined yet.

## The fix

Visibility now has a third arm — events of groups the caller is an
**approved member** of:

```js
{ $or: [
  { isPublic: true },
  { _id:     { $in: joinedEventIds } },
  { groupId: { $in: approvedMemberGroupIds } },
]}
```

- Approved membership only: a pending join-requester is a stranger until
  accepted (same rule as the member list, chat, and `listByGroup`), so a
  private group's events still never leak to them.
- Standalone private events (`groupId: null`) are unchanged: visible only to
  players who joined them.
- All other narrowings (region, date/includeExpired, status, geo) stay ANDed
  against the disjunction, exactly as before.

## Client impact

Group members now see their groups' upcoming private events in the main
`GET /events` list (with `joinedByMe: false`), matching what the group's own
event tab already showed. No request changes.
