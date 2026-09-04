# Change Log — 2026-09-04 · `GET /events/:id` returns the group's name and branding

**Branch:** `events-feature-spec`
**Tests:** 917 passing across 43 suites · build clean
**Verified:** unit only — mocked Mongoose.

`GET /events/:id` now resolves `groupId` into a `group` object, so a detail
header renders the group's name, logo and wallpaper without a second call to
the groups API.

---

## 1. Shape

**Additive — nothing moved, nothing was removed.**

```diff
  {
    "groupId": "6a6b...",
+   "group": {
+     "_id": "6a6b...",
+     "name": "Sunday Ballers",
+     "logo": "https://ik.imagekit.io/kickr/groups/logo_abc.png",
+     "wallpaper": "https://ik.imagekit.io/kickr/groups/wall_xyz.jpg"
+   },
    "groupRules": "No smoking\nArrive 15 min early",
    ...
  }
```

`groupId` still returned, `groupRules` still at the top level. An existing
client is unaffected.

## 2. Why nested rather than flat

The endpoint had precedent both ways: `groupRules` is flat, `location` is a
resolved nested object.

Nested was chosen (and put to the owner as a decision, since it is the
response's public shape) because it follows `location` — the closer analogue,
both being "resolve a reference into the object a screen needs" — and because
the next group field to be surfaced costs a key inside `group` rather than
another top-level name.

Folding `groupRules` into `group.rules` was offered and declined: it would have
been the cleanest end state but a breaking change for any client already
reading `groupRules`.

## 3. One query, not two

`findById` already fetched the group to read `rules`. The branding fields were
added to **that projection** — `.select('rules name logo wallpaper')` — so this
costs no extra round trip on a request that is already the heaviest in the API
(event, group, member, location, teams, matches).

A test asserts `groupModel.findById` is called exactly once *and* checks the
projection string, so a future refactor that adds a second lookup fails.

## 4. What is deliberately not in it

- **`logoFileId` / `wallpaperFileId`** — internal ImageKit handles, used for
  deletion. They are not client data, and a test asserts they are absent. This
  is why the projection is explicit rather than returning the whole document.
- **Members, rules, country/city** — all have their own endpoints. `group` is
  scoped to what a header needs.

## 5. Null semantics

| Case | `group` |
|---|---|
| Standalone event (no `groupId`) | `null`, and no group query is issued |
| `groupId` points at a **deleted** group | `null` — a dangling reference does not fail the request |
| Group exists, no logo set | object present, `logo: null` |

`null` rather than `''` for unset images: an absent image is absent, not empty.
A client checking `if (logo)` behaves identically either way, but `null` types
correctly in a Dart or TypeScript model.

Note the asymmetry with `groupRules`, which flattens to `''`: rules are always
renderable, so an empty string is the useful answer. A missing group is not
renderable, so the absence has to be visible.

## 6. Tests

Seven new cases in `events.service.spec.ts`:

- name, logo and wallpaper are attached, with the exact object asserted
- **one** group query, and the projection includes the branding fields
- ImageKit file ids and `rules` are absent from `group`
- unset images report `null`, not `''`
- a standalone event gets `null` and issues no group query
- a **deleted** group gets `null` and still returns the event
- `groupRules` remains at the top level (the regression guard for the additive
  claim)

**Verified by reverting:** with the projection narrowed back to `'rules'` and
the attached object removed, **6 of the 7 fail**. The seventh is the
`groupRules` guard, which correctly passes either way — worth stating, since a
test that cannot fail proves nothing.

The three pre-existing `groupRules` tests kept passing throughout, but they
mock the group as `{ rules }` with no name or images, so they only exercised the
new fallback path. That is why the new cases assert the populated shape
directly rather than relying on the existing ones.

## 7. Also fixed

`GET /events/:id` had **no `@ApiOperation` at all**, so Swagger listed it with
no description of a response that carries eight resolved fields. It now
documents what it returns, including the `userRole` vs `joinedByMe` distinction
(group role vs roster membership) that has caused confusion before.

## 8. Not verified

No live-database run: the projection has never been executed against real
data, so a group document missing `name` — which the schema marks required, but
legacy rows predate assumptions — would surface as `''` rather than being
caught here.
