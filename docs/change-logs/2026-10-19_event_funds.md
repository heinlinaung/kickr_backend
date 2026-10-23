# 2026-10-19 — Event Funds (expenses, settlement, group fund)

After players pay, the cashier records the event's expenses and **settles**
it: the system posts `net = collected − expenses` to the group's fund, a
ledger shown on the group detail page.

Group events only — a standalone event has no fund (`400 NOT_GROUP_EVENT`).

## Conventions

- Amounts are **2-place decimal strings** in THB (`"1800.00"`), in and out.
  A JSON number is rejected with `INVALID_AMOUNT`.
- **Writes**: the group's cashier or owner (`403 NOT_CASHIER`).
  **Reopen**: owner only (`403 NOT_GROUP_OWNER`).
  **Reads** (finance, fund, history): any approved member
  (`403 NOT_GROUP_MEMBER`). **Expense list** and **outstanding list**:
  cashier or owner — members see expenses only as per-category totals in
  the finance summary. A group can open the expense list to all approved
  members with `showExpenseDetailsToMembers: true` (on `POST /groups` and
  `PATCH /groups/:id`; default `false`).
- Errors carry a machine `code` beside `message`:
  `{ "statusCode": 409, "code": "EVENT_SETTLED", "message": "…" }`.
- Ids are Mongo ObjectIds (no `exp_` / `ft_` prefixes).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/events/:eventId/finance` | Event money summary |
| GET | `/events/:eventId/expenses` | List expenses (cashier or owner) |
| POST | `/events/:eventId/expenses` | Add an expense (201) |
| PATCH | `/events/:eventId/expenses/:expenseId` | Edit an expense |
| DELETE | `/events/:eventId/expenses/:expenseId` | Remove (soft delete, 204) |
| PATCH | `/events/:eventId/fee` | Set a new per-player price |
| POST | `/events/:eventId/settle` | Settle, post net to the fund (200) |
| POST | `/events/:eventId/reopen` | Undo a settlement (200) |
| GET | `/groups/:groupId/fund` | Fund summary (also `fund` on `GET /groups/:id`) |
| GET | `/groups/:groupId/fund/transactions` | Ledger, newest first |
| GET | `/groups/:groupId/expenses` | Expenses across the group's events (cashier or owner) |
| GET | `/groups/:groupId/outstanding` | Who still owes, per event |
| GET | `/me/outstanding` | The caller's own debts |

### `GET /events/:eventId/finance`

```json
{
  "eventId": "…", "currency": "THB", "status": "OPEN",
  "income": {
    "feePerPlayer": "120.00", "updatedPrice": null, "pricePerPlayer": "120.00",
    "players": 20, "expected": "2400.00", "collected": "2280.00",
    "outstanding": "120.00", "unpaidCount": 1, "pendingReviewCount": 0,
    "overpaidCount": 0, "creditOwed": "0.00"
  },
  "expenses": { "total": "2000.00", "byCategory": [
    { "category": "STADIUM", "amount": "1800.00" },
    { "category": "DRINKS", "amount": "200.00" } ] },
  "net": "280.00", "settledAt": null, "settledBy": null
}
```

- `feePerPlayer` = `price` + `additionalPrice` (when `takeAdditionalPrice`).
- `pricePerPlayer` = `updatedPrice` if set, else `feePerPlayer`.
- `players` = registered members who joined (guests/anonymous are not billed).
- `collected` = all approved money, including from members who later left.
- `outstanding` = what joined players still owe (sum per member, so an
  overpaid member does not offset someone else's debt).
- `unpaidCount` counts UNPAID and PARTIAL members; `pendingReviewCount` =
  submissions waiting for review.
- `overpaidCount` / `creditOwed` — **additions to the spec**: members who
  paid more than a lowered price, and the total owed back to them.

### Expenses

`POST` body: `category` (STADIUM | DRINKS | EQUIPMENT | OTHER), `amount`
(> 0), `note` (**required for OTHER** → `400 NOTE_REQUIRED`), optional
`paidMethod` (CASH | BANK_TRANSFER), `receiptUrl`. PATCH takes any of the
same fields. All three writes → `409 EVENT_SETTLED` once settled.

### `PATCH /events/:eventId/fee`

Body `{ "updatedPrice": "150.00" | null, "reason": "…" }`. Full new price
(≥ 0, `NEGATIVE_PRICE` below), or `null` to go back to the event's fee.
OPEN only. Every change is kept in `eventfeeadjustments`; every joined
player is notified of the new price and what they still owe.

Each member's standing is recalculated against the new price:

| Paid vs. price | Status | In outstanding as |
| --- | --- | --- |
| nothing (or only rejected) | UNPAID | full price |
| top-up submitted, not reviewed | PENDING | the difference |
| less (120 of 150) | PARTIAL | the difference (30) |
| exactly | APPROVED | — |
| more (120 of 100) | OVERPAID | — (counted in `creditOwed`) |

To pay the difference the member submits again via
`POST /events/:id/payments`; the cashier reviews it as usual.

### `POST /events/:eventId/settle`

Body `{ "note"?: "…", "allowOutstanding"?: true }`. In order:

- `409 EVENT_SETTLED` — already settled (never posts twice, even when two
  cashiers press at once).
- `409 EVENT_NOT_FINISHED` — the event must be `after_match`/`done`, or past
  its `endTime`. Cancelled events never qualify.
- `409 PENDING_REVIEWS` — approve or reject pending payments first.
- `409 OUTSTANDING_PAYMENTS` — players still owe and `allowOutstanding` is
  not `true`; the body lists `owing: [{ member, amount, status }]`.

A negative net is allowed and reduces the fund. Response:
`{ eventId, status, collected, expenses, net, outstanding,
fundTransactionId, groupFundBalance, settledAt }`.

### `POST /events/:eventId/reopen`

Owner only, body `{ "reason": "…" }`. Adds a `SETTLEMENT_REVERSAL` (the
original ledger row stays) and returns the finance summary with
`status: "OPEN"`. `409 EVENT_NOT_SETTLED` on an open event.

### Group fund

`GET /groups/:groupId/fund` → `{ groupId, currency, balance,
totals: { income, expenses }, outstanding, settledEvents, recentEvents[5],
updatedAt }`. `outstanding` = unpaid fees across **settled** events.

`GET /groups/:id` now carries the same object as `fund` — **for approved
members (and the cashier) only**; `null` for everyone else, since group
detail is public.

`GET /groups/:groupId/fund/transactions?type=&from=&to=&limit=&cursor=` →
`{ items: [{ id, type, amount, balanceAfter, eventId, memberId, note,
createdBy, createdAt }], nextCursor }`.

| Type | Sign | When |
| --- | --- | --- |
| EVENT_SETTLEMENT | ± | settle (its net) |
| LATE_PAYMENT | + | a payment approved after settlement |
| SETTLEMENT_REVERSAL | opposite of the original | reopen |
| PAYMENT_REVERSAL | − | an approved payment on a settled event rejected |

### `GET /groups/:groupId/expenses`

`?category=STADIUM|DRINKS|EQUIPMENT|OTHER&eventId=&from=&to=&limit=&cursor=`
→ `{ groupId, currency, total, items: [{ id, category, amount, note,
paidMethod, receiptUrl, createdBy, updatedBy, createdAt, updatedAt,
event: { id, title, date }, eventSettled }], nextCursor }`, newest first.
Item fields match `GET /events/:eventId/expenses`. `from`/`to` filter on
when the expense was recorded (`createdAt`). `total` sums every match of
the filters, not only the page. Open events are included; `eventSettled`
marks the locked ones (so with no filters `total` can exceed the fund
summary's `totals.expenses`, which counts settled events only). Same
access as the per-event list: cashier or owner (`403 NOT_CASHIER`), or
any approved member when `showExpenseDetailsToMembers` is on.

### Outstanding

`GET /groups/:groupId/outstanding?memberId=&includePending=true&eventStatus=all|settled&limit=&cursor=`
→ `{ groupId, currency, totalOutstanding, playerCount, items: [{ member,
totalOwed, events: [{ eventId, title, date, amount, status, eventSettled }]
}], nextCursor }`. Players by `totalOwed` desc, their events oldest first.
`status` is UNPAID, PENDING or PARTIAL. `eventStatus=all` covers settled
events plus events that have ended but are not settled; upcoming and
cancelled events owe nothing. With `eventStatus=settled&includePending=true`
the total equals `outstanding` in the fund summary.

`GET /me/outstanding` — same shape, at most one item; across all the
caller's group events, or one group with `?groupId=`.

## Changes to existing payment endpoints

- **`PATCH /events/:id/payments/:memberId/review`** — on a SETTLED event,
  approving posts a `LATE_PAYMENT`; un-approving (approved → rejected)
  posts a `PAYMENT_REVERSAL`. The event stays settled; its summary figures
  update. On an OPEN event nothing is posted (settle counts it).
- **`POST /events/:id/payments`** — an `approved` member who is PARTIAL
  after a price rise may submit again (the top-up). The approved receipt is
  kept, not deleted.
- **Payment rows** gain `amount` (what this submission is for) and
  `paidAmount` (approved running total). A row whose last top-up was
  rejected reads `status: "rejected"` while `paidAmount` still holds the
  earlier approval — use the finance/outstanding endpoints for a member's
  balance, not the raw status.
- Rows from before today have neither field: an approved one counts as the
  full event fee. **No migration needed.**

## Rules worth knowing

- **Ledger, not a balance.** The fund balance is only ever moved by
  inserting a transaction; `balanceAfter` is stored per row.
  Invariant: `balance = totals.income − totals.expenses`.
- **Resettle doesn't double count.** Late payments posted while settled
  stay in the ledger after a reopen. Resettling posts the corrected net
  *minus* what the event already has in the ledger, so the event's total
  contribution always equals its true net.
  Example: settle 280 → late +120 → reopen −280 → drinks fixed (200 → 250)
  → resettle posts +230 → event total 350 = 2400 − 2050.
- **Concurrency.** Settle, reopen, expense/fee writes and late-payment
  posting run in a MongoDB transaction and all write the event's settlement
  row and the group's fund row, so concurrent writes conflict and retry.
  Settle/reopen also flip state with a compare-and-set, so a double settle
  is refused even without transactions.
- **Standalone mongod (local dev)** can't run transactions; the service
  logs a warning once and runs the writes without atomicity. Atlas
  (production) is a replica set and is unaffected.

## New collections

`eventexpenses` (soft delete via `deletedAt`/`deletedBy`),
`eventsettlements` (one per event, unique `eventId`), `groupfunds` (one per
group, unique `groupId`), `groupfundtransactions`, `eventfeeadjustments`.
New field `Event.updatedPrice` (nullable).
