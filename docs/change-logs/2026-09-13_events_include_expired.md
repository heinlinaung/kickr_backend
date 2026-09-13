# Change Log — 2026-09-13 · `GET /events?includeExpired=`

**Branch:** `events-feature-spec`
**Tests:** 1064 passing across 52 suites · build clean
**Verified:** unit only.

`GET /events` can now hide past-dated events. Additive — the default is
unchanged.

---

## 1. Two different notions of "finished"

Worth separating up front, because `GET /events` now has both and they are
easily conflated:

| Filter | Question it answers | On this route |
|---|---|---|
| **status** `after_match` / `done` | Was the match **played**? | Hidden by default since 2026-09-03 |
| **date** `< today` | Has the **day** passed? | New — `includeExpired=false` |

They are independent. An event can be **past-dated but still `join`** because
nobody advanced its status — the common real case, and exactly what the new flag
catches. It can equally be `done` with a future date.

So this did not replace the status rule; it sits beside it. A test asserts both
appear in the filter together.

## 2. The default is `true` — deliberately inconsistent

`/events/joined` and `/events/group/:id` both default `includeExpired` to
**false**. This route defaults it to **true**.

That inconsistency was chosen rather than overlooked. Making it `false` would be
a **silent breaking change**: every existing client's discovery list would
quietly lose rows, with no error and nothing in the response to explain it. A
client that wants the tighter behaviour opts in.

The cost is one flag with two defaults depending on the route, which is
genuinely confusing — so it is stated in the Swagger description, the API doc
and the gotchas checklist rather than left to be discovered.

## 3. The parsing trap this created

The other routes read the flag as:

```ts
includeExpired === 'true'
```

That is correct where the default is `false` — an absent parameter reads as
`false`. **Copying it here would have inverted the new default**, hiding expired
events for every caller who did not pass the parameter, which is precisely the
silent breakage §2 avoids.

So this route reads:

```ts
includeExpired === undefined ? true : includeExpired !== 'false'
```

Only the exact string `'false'` opts out. A typo shows *more* rows rather than
fewer — the safer direction for a discovery list.

A new controller spec covers it, and **switching to the other routes' idiom
fails 3 of its 8 tests.** That is the whole reason the spec exists: the mistake
is a one-line copy-paste that no existing test would have caught.

## 4. A latent bug found while writing it

`from`/`to` **assigned** `filter.date`:

```ts
if (from || to) {
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);
  filter.date = range;   // <- assignment, not merge
}
```

An expiry bound written as a separate `filter.date = ...` would have been
**silently discarded** the moment a caller passed `?from=` or `?to=` — the two
rules would have looked independent in the code and quietly fought at runtime.

All date bounds are now built in one `range` object, so:

- `?from=` **overrides** the expiry floor — the caller named their own window,
  and keeping the later of the two would be surprising (asking for last month
  and getting nothing);
- `?to=` **combines** with it, giving "today until then";
- when nothing asks for a date, the key is **absent** rather than `{}`, since an
  empty object would match every document and lose the index.

Each of those three is a test.

## 5. Tests

**14 new cases.**

*Service (6):* expired events included by default; `$gte: startOfToday()` when
the flag is false; the date rule coexisting with the status exclusion; `?from=`
overriding the floor; `?to=` combining with it; and no `date` key at all when
nothing asks for one.

*Controller (8):* the default is `true` with the parameter absent; `'false'`
opts out; `'true'` opts in; any other value reads as `true`; an empty string is
not inverted; plus region/from/to/status passing through untouched and `radius`
becoming a number rather than `NaN` when absent.

**Verified by reverting, twice:** disabling the expiry filter fails 3 service
tests; using the other routes' `=== 'true'` idiom fails 3 controller tests.

That the full suite stayed green *before* these were added is itself the point —
1050 existing tests could not tell whether the flag worked, because none of them
passed it.

## 6. Usage

```bash
URL=http://localhost:3000
TOKEN=<Cognito ACCESS token>
```

### Default — expired events included

```bash
curl -s "$URL/events" -H "Authorization: Bearer $TOKEN"
```

Past-dated events still in `join` or `playing` are returned. `after_match` and
`done` are not, by status.

### Hide past-dated events

```bash
curl -s "$URL/events?includeExpired=false" -H "Authorization: Bearer $TOKEN"
```

### Combine with a ceiling

```bash
curl -s "$URL/events?includeExpired=false&to=2026-12-31" \
  -H "Authorization: Bearer $TOKEN"
```

Today until year end.

### `?from=` wins over the flag

```bash
curl -s "$URL/events?includeExpired=false&from=2020-01-01" \
  -H "Authorization: Bearer $TOKEN"
```

Returns events from 2020 onward. The explicit window is the caller's stated
intent, so it overrides the expiry floor rather than being narrowed by it.

## 7. Not changed

- **The other three lists.** `/events/joined`, `/events/group/:id` and
  `/events/search` keep their existing defaults and parsing. Making all four
  agree would be a breaking change on this route, which §2 rejects.
- **The status exclusion.** `after_match` and `done` are still hidden by default
  and still reachable with an explicit `?status=`.
