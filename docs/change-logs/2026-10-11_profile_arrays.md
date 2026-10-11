# 2026-10-11 — preferredSport & footballPosition become arrays

A player prefers more than one sport and covers more than one position, so
both profile fields now hold **arrays of strings** instead of a single
string.

## ⚠ Breaking change — `PATCH /users/me`

```json
// before
{ "preferredSport": "football", "footballPosition": "defender" }

// after
{
  "preferredSport": ["football", "futsal"],
  "footballPosition": ["defender", "midfielder"]
}
```

- A single string is now a **400** — send an array, even for one value.
- Sending a field REPLACES its stored list (same semantics as `sports`).
- `[]` clears the field.
- Validation unchanged in spirit: every `preferredSport` entry must exist
  in the `sporttypes` collection ("Unknown preferredSport 'x'. Valid
  values: …"); every `footballPosition` entry must be one of goalkeeper /
  defender / midfielder / forward / playmaker (DTO-level 400).

Reads (`GET /users/me`, public profile) return the arrays.

## Migration

Run once per environment — wraps existing single strings into one-element
arrays ('' and null become `[]`; arrays are left untouched, so re-running
is safe):

```
npx ts-node scripts/migrate-user-profile-arrays.ts          # dry run
npx ts-node scripts/migrate-user-profile-arrays.ts --apply
```

## Not changed

`sports` was already an array. Signup takes neither field — profile data
arrives only through `PATCH /users/me`.
