# 2026-09-19 — event template body mirrors event create; teamCount removed

## What changed

`POST /event-templates` now accepts the same structure and fields as
`POST /events`, plus the template's own `name`:

```json
{
  "name": "Tuesday 5-a-side",
  "groupId": "665f1a2b3c4d5e6f7a8b9c0d",
  "title": "Friday Night Football",
  "description": "Casual 11v11 match at the park",
  "date": "2026-07-01T18:00:00.000Z",
  "isPublic": true,
  "locationId": "507f1f77bcf86cd799439011",
  "maxPlayers": 22,
  "sportType": "football",
  "subType": "stadium",
  "skillLevel": "beginner",
  "price": 0,
  "additionalPrice": 5,
  "takeAdditionalPrice": false,
  "isAllowExtraPlayer": false,
  "duration": 90,
  "registrationClosingDuration": 120
}
```

New template fields: `date`, `subType`, `additionalPrice`,
`takeAdditionalPrice`, `isAllowExtraPlayer`, `duration`,
`registrationClosingDuration` — each with the same validation bounds as on
event create. Everything except `name` stays optional: a template supplies
only what the organizer wants pre-filled.

All the new fields except `date` are also FILLED into an event created with
`templateId` when the caller omits them. A filled `subType` is validated
against the resolved sport exactly like an explicit one — a template's
`stadium` landing on a padel group's event is a 400, not a stored
meaningless value. `sportType`/`subType` are checked against the
`sporttypes` collection at template SAVE time too, so a bad pair fails when
saved rather than months later on first use.

### `date` — stored, never filled

Included so the template body matches the event-create body, and stored on
the template — but never copied into a created event: `date` is **required**
on `POST /events`, so the caller always supplies the real instant and the
fill (omitted fields only) can never apply it.

### `teamCount` — removed from templates completely

- Gone from the DTO: with the global `forbidNonWhitelisted` pipe, a client
  still sending `teamCount` to `POST /event-templates` gets a **400** naming
  the property.
- Gone from the schema and from the create-time fill list — an event created
  from any template (old documents included, which may still carry the field;
  nothing reads it) gets the event schema's own `teamCount` default (4).
- `teamCount` on the EVENT itself is untouched: still settable on event
  create/update, still drives shuffle.

## Client impact

- Template create/list now carry the richer field set; old bodies keep
  working except any that sent `teamCount` (now a 400 — stop sending it).
- No migration: new fields read as `null` ("no default here") on existing
  templates, which the fill already skips.
