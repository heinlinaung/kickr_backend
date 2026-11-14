# Challenge events: invitation flag on `GET /events/:id/players`

## What changed

On a **challenge** event, `GET /events/:id/players` now lists **every player
either side invited** (not just the ones who accepted). Each row has a `flag`:

| `flag`       | Meaning                                         | Row `status` |
| ------------ | ----------------------------------------------- | ------------ |
| `approved`   | Accepted the invitation                         | `joined`     |
| `reject`     | Declined, or the invitation was withdrawn/unassigned | `cancelled`  |
| `not_submit` | Has not answered yet                            | `invited`    |

`inviteRejectReason` is on the row when a player declined with a reason.
`userId` and `groupId` (the side) are populated.

## Query params (challenge events only)

| Param     | Type     | Notes                                               |
| --------- | -------- | --------------------------------------------------- |
| `flag`    | string   | `approved`, `reject` or `not_submit`                |
| `groupId` | ObjectId | One side only. Must be one of the two challenge groups. |

```http
GET /events/6a70…/players?flag=not_submit&groupId=665f…
```

```json
[
  {
    "_id": "…",
    "userId": { "_id": "…", "name": "Aung", "profileImage": "…", "footballPosition": ["CM"] },
    "groupId": { "_id": "665f…", "name": "B FC" },
    "status": "invited",
    "inviteRejectReason": null,
    "flag": "not_submit"
  }
]
```

## Errors

- `400`: invalid event id; `flag` or `groupId` on a non-challenge event;
  `groupId` is not one of the two challenge groups; `flag` not one of the
  three values
- `404`: event not found

## Unchanged

Normal events return the same roster as before (joined players and approved
guests), with no `flag`.
