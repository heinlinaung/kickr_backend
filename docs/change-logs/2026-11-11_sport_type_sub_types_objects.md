# 2026-11-11 — Sport type subTypes as objects

A sport's `subTypes` are now objects instead of strings, and they are managed
on the sport type itself. The separate `/sub-types` endpoints are gone.

---

## Removed

- `POST   /sport-types/:value/sub-types`
- `PUT    /sport-types/:value/sub-types/order`
- `PATCH  /sport-types/:value/sub-types/:subType`
- `DELETE /sport-types/:value/sub-types/:subType`

## Changed: subTypes shape (every response)

`GET /sport-types`, `GET /sport-types/:value`, the POST / PATCH responses
and **`GET /configuration` → `sportTypes`** now return:

```json
"subTypes": [
  { "value": "futsal",  "name": "Futsal",  "sortOrder": 1 },
  { "value": "stadium", "name": "Stadium", "sortOrder": 2 }
]
```

Before, this was `["futsal", "stadium"]`. **App clients that read `subTypes` as
strings need updating.** The list comes back sorted by `sortOrder`.

- `value`: what an event stores as `subType`. It doesn't change, and events
  still send and receive the plain `value` string.
- `name`: the display label.
- `sortOrder`: the display position.

## Changed: POST /sport-types and PATCH /sport-types/:value

Both accept `subTypes` as an array of `{ value, name?, sortOrder? }`:

- `name` defaults to `value`. `sortOrder` defaults to the item's 1-based
  position in the array.
- A repeated `value` → `400`.
- **PATCH replaces the whole list.**
  - **Add:** include a new `value`.
  - **Rename:** keep the `value` and change `name`. No events need moving.
  - **Reorder:** change `sortOrder`, or the order of the array.
  - **Remove:** leave the subType out. This is refused with `409` while any event or
    event template of the sport still uses it.

```json
PATCH /sport-types/football
{
  "subTypes": [
    { "value": "stadium", "name": "Eleven-a-side", "sortOrder": 1 },
    { "value": "futsal",  "name": "Futsal",        "sortOrder": 2 },
    { "value": "beach",   "name": "Beach" }
  ]
}
```

## Data

Rows still storing strings are read as `{ value, name: value, sortOrder }`,
so nothing breaks before migration. Run
`npx ts-node scripts/seed-sport-types.ts --apply` to rewrite them as objects.
