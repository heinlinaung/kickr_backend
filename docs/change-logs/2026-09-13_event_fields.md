# Change Log — 2026-09-13 · Two new event fields

**Branch:** `events-feature-spec`
**Tests:** 1050 passing across 51 suites · build clean
**Verified:** unit only. §6.

Two additive fields on `POST /events`, both also editable via `PATCH`.

| Field | Unit | Default |
|---|---|---|
| `registrationClosingDuration` | **minutes** before kick-off | `0` |
| `subType` | `futsal` \| `stadium` | `null` |

---

## 1. `registrationClosingDuration`

How long before kick-off registration closes.

The name is long on purpose. `duration` already exists on the event and means
how long it **runs** — same unit, opposite direction, which is the pairing most
likely to be confused. The unit is repeated at every point a caller meets it:
the schema, both DTOs, the Swagger description and the API doc.

**Stored as an offset, not an absolute closing time.** Rescheduling the event
then moves the deadline with it, rather than leaving a stale timestamp behind
pointing at the old start.

**Defaults to `0`**, meaning registration never closes early. That is the
pre-existing behaviour, so an event created before this field existed reads
correctly without a migration.

**Capped at 10080** (one week). A longer offset is far more likely a unit
mix-up — hours or days entered as minutes — than a real intention, and
rejecting it says so rather than silently closing registration before the event
was announced.

> **Nothing enforces it yet.** This change stores the value; no code path reads
> it to actually refuse a join. `POST /events/:id/join` is still gated only by
> `status` and capacity. Enforcement is a separate change — flagged here so the
> field is not mistaken for working behaviour.

## 2. `subType`

The format of a football event.

The original request was for hours; it was corrected to minutes mid-change for
the field above, and this second field arrived mid-change too. Both are recorded
as asked, with one modelling problem raised rather than worked around:

**`futsal` is already a top-level `sportType`** — on events, groups *and* user
profiles. Adding it as a football sub-type creates two ways to say the same
thing: `sportType: 'futsal'` or `sportType: 'football'` + `subType: 'futsal'`,
with nothing reconciling them.

Three options were put to the owner:

| | Cost |
|---|---|
| **Add `subType`, leave `sportType` alone** ← chosen | The ambiguity exists; a client filtering for futsal must check both |
| Drop `futsal` from the event sportType enum | Breaking: existing futsal events need migrating, and group/profile enums diverge |
| Name the values something non-colliding | Avoids it entirely, but does not match the requested wording |

The ambiguity is therefore **deliberate and documented**, not an oversight. It
is stated on the schema field, in both DTOs and in the API doc, so a client
filtering for futsal knows to check both.

**`null` by default, meaning unspecified** — explicitly not a synonym for
`stadium`. An event created before this field existed did not choose stadium; it
said nothing, and defaulting to a real value would invent an answer. A test pins
this.

### Rejected, not silently dropped

`subType` on a non-football event is a **400**. A caller who sends it believes
it took effect, and a stored-but-meaningless value is worse than an error.

The `PATCH` path checks the **result** of the patch, not the patch alone: a
caller can change `sportType`, `subType`, or both, and switching a football
event to futsal while leaving an old `subType` behind would otherwise strand a
meaningless value. Create and update share one guard so they cannot diverge.

## 3. Also editable via PATCH

Both fields were added to `UpdateEventDto`, which is a separate hand-written
class rather than a derived partial.

Without that, `PATCH /events/:id` would **reject** them with a 400 under
`forbidNonWhitelisted`, and a field settable at creation and never changeable
afterwards is a dead field — the same trap `favouriteTeamId` hit on 2026-09-05.
Raised as a decision rather than assumed.

## 4. Not added to event templates

`FILLABLE` in `create` — the list a template may fill for omitted fields —
covers `title`, `description`, `maxPlayers`, `teamCount`, `sportType`,
`skillLevel`, `price`, `isPublic`. Neither new field was added.

`duration` is not in that list either, so this is consistent rather than an
omission. Widening it would also mean a Template schema change, which is beyond
what was asked. Worth revisiting if organizers want a template to carry a
standard closing window.

## 5. Tests

**21 new cases.**

*DTO (16):* both fields accepted on create and update; `0` accepted explicitly
(it is the default AND a legal value to send); negative, fractional and
over-a-week rejected; both optional; schema defaults pinned — `0` for the
offset, `null` for `subType`, which are deliberately different; each enum value
accepted and an out-of-enum value rejected; and that `duration` and
`registrationClosingDuration` are carried independently, since that is the pair
most likely to be conflated.

*Service (5):* the combination guard, which the DTO cannot cover — a football
subType accepted; accepted with `sportType` omitted since it defaults to
football; **rejected** on a non-football event; **no event written** when
rejected; and a non-football event with no subType allowed.

**Verified by reverting:** disabling the guard fails 2 of the 5 service tests.

## 6. What is NOT verified

- **No live database.** The new schema fields have never been written to real
  Mongo. Both are additive with defaults, so existing documents need no
  migration — but that is reasoned, not observed.
- **`registrationClosingDuration` is stored and never read.** Nothing closes
  registration yet; see §1.
- **The futsal ambiguity has not been exercised.** No client has tried filtering
  events by futsal across both representations.

## 7. Usage

```bash
URL=http://localhost:3000
TOKEN=<Cognito ACCESS token>
```

### Create with both fields

```bash
curl -s -X POST "$URL/events" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "title": "Friday five",
    "date": "2026-09-27T18:00:00.000Z",
    "sportType": "football",
    "subType": "stadium",
    "duration": 90,
    "registrationClosingDuration": 120
  }'
```

`duration: 90` — the event runs 90 minutes.
`registrationClosingDuration: 120` — registration closes 2 hours before it
starts.

### Change the closing window later

```bash
curl -s -X PATCH "$URL/events/<id>" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"registrationClosingDuration": 30}'
```

### subType on a non-football event — 400

```bash
curl -s -X POST "$URL/events" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "title": "Futsal night",
    "date": "2026-09-27T18:00:00.000Z",
    "sportType": "futsal",
    "subType": "stadium"
  }'
```

```json
{
  "statusCode": 400,
  "message": "subType is only valid when sportType is 'football' (got 'futsal')",
  "error": "Bad Request"
}
```

### An offset beyond a week — 400

```json
{ "message": ["registrationClosingDuration must not be greater than 10080"] }
```
