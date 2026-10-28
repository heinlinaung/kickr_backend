# 2026-10-26 — Group locations CRUD, `/locations` removed

Locations are now managed only under their group. All endpoints require a JWT
and return the payload inside the standard `{ "data": … }` envelope.

## Removed ⚠️

| Method | Path               |
| ------ | ------------------ |
| POST   | `/locations`       |
| GET    | `/locations`       |
| GET    | `/locations/{id}`  |
| PATCH  | `/locations/{id}`  |
| DELETE | `/locations/{id}`  |

These now return `404`. The old attach body on `POST /groups/:id/locations`
(`{ locationId }` / `{ location: {...} }`) is gone too.

## New

| Method | Path                                      | Who                                  | Purpose                              |
| ------ | ----------------------------------------- | ------------------------------------ | ------------------------------------ |
| POST   | `/groups/:groupId/locations`              | Owner/admin                          | Create a location (max 5 per group)  |
| GET    | `/groups/:groupId/locations`              | Any authenticated user               | List the group's locations           |
| GET    | `/groups/:groupId/locations/:locationId`  | Any authenticated user               | One location of the group            |
| PATCH  | `/groups/:groupId/locations/:locationId`  | Owner/admin/captain/vice-captain     | Edit a location the group owns       |
| DELETE | `/groups/:groupId/locations/:locationId`  | Owner/admin                          | Delete a location the group owns     |

- `POST` body: `name`, `lat`, `lng` (required), `url`, `metadata`. `groupId`
  in the body is rejected: the group comes from the path.
- `PATCH` body: the same fields, all optional.
- Only the caller's **approved** role in `:groupId` counts. Being the
  location's creator gives no extra rights on these routes.
- A location attached to the group but owned by another group can be read
  here. `PATCH` returns `403`, and `DELETE` only detaches it from this group
  (`{ "message": "Location detached" }`).
- Deleting a location the group owns also removes it from every other group
  that referenced it.

## Errors

| HTTP | Message                                                         |
| ---- | --------------------------------------------------------------- |
| 400  | `A group may have at most 5 locations`                          |
| 403  | `You do not have permission to manage this group's locations`   |
| 403  | `This location is attached to the group but owned elsewhere`    |
| 404  | `Group not found` / `Location not found in this group`          |

## Create-group flow

Create the group first, then `POST /groups/:groupId/locations` for each venue.
`locationIds` on `POST /groups` is still accepted, but with no top-level
create endpoint a client normally has no ids to send.
