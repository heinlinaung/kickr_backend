# 2026-10-03 — Payment After Event (cashier flow)

Members now SUBMIT their payment (cash or bank transfer with a receipt
image) and the group's **cashier** approves or rejects it. This REPLACES
organizer direct-marking.

## ⚠ Breaking change

`PATCH /events/:id/payments/:memberId` (organizer marks paid/unpaid) is
**removed**. Mobile must ship the new submit/review flow in the same
release. `EventPayment` rows changed shape: `isPaid/paidAt/recordedBy` →
`method/status/proof*/submittedAt/reviewedBy/reviewedAt/rejectReason`.

Run the migration once per environment:

```
npx ts-node scripts/migrate-event-payments.ts          # dry run
npx ts-node scripts/migrate-event-payments.ts --apply
```

Existing `isPaid: true` rows become approved cash payments (reviewer =
whoever marked them); `isPaid: false` rows are removed — "unpaid" is the
absence of a row.

## Cashier (one per group)

- `group.cashierId`, default null. Appointed by the **owner** only:
  `PATCH /groups/:id/cashier` with `{ "userId": "<id>" }` — must be an
  approved member; the owner may appoint themself. `{ "userId": null }`
  removes the cashier.
- **No cashier → payment reviews are BLOCKED** (400 "no cashier yet — ask
  the owner to appoint one"). No silent fallback, by design.
- Non-group events have no cashier; the **event creator** reviews there.

## Receiving details (what members pay against)

- `GET /groups/:id/payment-details` — approved members; returns
  `{ cashierId, paymentDetails: { bankAccountNumber, bankName,
  accountHolderName, qrCodeUrl } }`.
- `PUT /groups/:id/payment-details` — **cashier only**; sets the account
  fields, the QR survives.
- `PUT /groups/:id/payment-details/qr` — **cashier only**; multipart
  `file` (JPEG/PNG/WebP, 10MB), replaces the previous QR image.

## Payment flow

### `POST /events/:id/payments` — member submits their OWN payment

Multipart: `method` = `cash` | `bank_transfer`, plus `file` (the receipt
screenshot) — **required for bank_transfer**, ignored for cash. Joined
players only.

- Creates/updates the member's single row → `status: "submitted"`;
  notifies the cashier (creator for non-group events).
- Resubmitting while `submitted` replaces the claim; after `rejected` it
  clears the verdict and returns to review (old proof file is deleted).
- `approved` is settled — further submissions are 400.

### `PATCH /events/:id/payments/:memberId/review` — cashier verdict

Body `{ "action": "approve" | "reject", "reason": "..." }` — reason
required on reject and shown to the member. Stamps
`reviewedBy`/`reviewedAt`; re-reviewing is allowed to correct mistakes.
Notifies the member either way.

### `GET /events/:id/payments`

Cashier and organizer (owner/admin/creator) see every row; everyone else
sees only their own. Rows now carry `method`, `status`, `proofUrl`,
`submittedAt`, `reviewedBy`, `reviewedAt`, `rejectReason`. No amount is
stored — the event's `price` (+ `additionalPrice`) stays the one source
of truth.

## Mobile notes

- Statuses to render: no row = not submitted; `submitted` = waiting for
  review; `approved` = paid; `rejected` = show `rejectReason` + a
  resubmit button.
- The cashier seat is per group: check `cashierId` from
  `GET /groups/:id/payment-details` to decide whether to show review UI.
- 400 on review with "no cashier yet" → prompt the owner to appoint one.

## Deploy

1. `npx ts-node scripts/migrate-event-payments.ts --apply`
2. No new env vars; QR/proof images use the existing ImageKit account
   (folders `payment-qr`, `payment-proofs`).
