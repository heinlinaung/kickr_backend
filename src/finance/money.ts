// src/finance/money.ts
/**
 * Money arithmetic for Event Funds — pure, no Mongoose, no Nest.
 *
 * Every calculation runs in integer SATANG (1/100 THB). Amounts are stored as
 * plain Numbers in baht to match `Event.price`, which has always been a
 * Number, but a sum of baht floats drifts (0.1 + 0.2), so values are
 * converted to cents on the way in and formatted back on the way out. The
 * API never sends or accepts a float: amounts travel as 2-place decimal
 * strings ("1800.00").
 */
import { BadRequestException } from '@nestjs/common';

export const CURRENCY = 'THB';

/** Up to 10 integer digits — the decimal(12,2) the spec sizes columns at. */
const AMOUNT_PATTERN = /^\d{1,10}\.\d{2}$/;

/** Baht Number (as stored) -> integer satang. Null/undefined read as 0. */
export function toCents(baht: number | null | undefined): number {
  if (baht == null || !Number.isFinite(baht)) return 0;
  return Math.round(baht * 100);
}

/** Integer satang -> baht Number, for storage. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Integer satang -> "1800.00" (signed: "-200.00"). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/** Baht Number -> "1800.00". */
export function formatBaht(baht: number | null | undefined): string {
  return formatCents(toCents(baht));
}

/**
 * Parses a client amount string into satang, or throws `INVALID_AMOUNT`.
 *
 * Strings only: a JSON number has already been through a float by the time
 * it reaches us, which is exactly what the string convention exists to
 * avoid. `allowZero` is for prices (a free event is legal); expenses must be
 * strictly positive.
 */
export function parseAmount(
  value: unknown,
  { allowZero = false }: { allowZero?: boolean } = {},
): number {
  if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_AMOUNT',
      message:
        'Amount must be a decimal string with two places, e.g. "1800.00"',
    });
  }
  const [whole, frac] = value.split('.');
  const cents = Number(whole) * 100 + Number(frac);
  if (cents === 0 && !allowZero) {
    throw new BadRequestException({
      code: 'INVALID_AMOUNT',
      message: 'Amount must be greater than 0',
    });
  }
  return cents;
}

/**
 * What the event charges per player before any adjustment: `price`, plus
 * `additionalPrice` when `takeAdditionalPrice` is on.
 */
export function feePerPlayerCents(event: {
  price?: number | null;
  additionalPrice?: number | null;
  takeAdditionalPrice?: boolean | null;
}): number {
  return (
    toCents(event.price) +
    (event.takeAdditionalPrice ? toCents(event.additionalPrice) : 0)
  );
}

/** The price actually charged: `updatedPrice` when the cashier set one. */
export function pricePerPlayerCents(event: {
  price?: number | null;
  additionalPrice?: number | null;
  takeAdditionalPrice?: boolean | null;
  updatedPrice?: number | null;
}): number {
  return event.updatedPrice != null
    ? toCents(event.updatedPrice)
    : feePerPlayerCents(event);
}

export type MemberBalanceStatus =
  | 'UNPAID'
  | 'PENDING'
  | 'PARTIAL'
  | 'APPROVED'
  | 'OVERPAID';

/** The slice of an EventPayment row the balance depends on. */
export interface PaymentLike {
  status: string;
  amount?: number | null;
  paidAmount?: number | null;
}

/**
 * Approved money on one payment row, in satang.
 *
 * `paidAmount` is the running total of approved submissions. Rows approved
 * before Event Funds existed have no `paidAmount`: back then the only price
 * was the event fee and an approval meant "paid in full", so the fee is what
 * they paid.
 */
export function paidCents(
  row: PaymentLike | null | undefined,
  feeCents: number,
): number {
  if (!row) return 0;
  if (row.paidAmount != null) return toCents(row.paidAmount);
  return row.status === 'approved' ? feeCents : 0;
}

/**
 * One member's standing on one event — the single derivation behind the
 * finance summary, settlement checks and the outstanding lists.
 *
 * `owedCents` is what is still missing (0 once covered); `creditCents` is
 * what was paid beyond the price and is owed back.
 */
export function memberBalance(
  row: PaymentLike | null | undefined,
  priceCents: number,
  feeCents: number,
): {
  status: MemberBalanceStatus;
  paidCents: number;
  owedCents: number;
  creditCents: number;
} {
  const paid = paidCents(row, feeCents);
  const owed = Math.max(0, priceCents - paid);
  const credit = Math.max(0, paid - priceCents);

  let status: MemberBalanceStatus;
  if (owed === 0) status = credit > 0 ? 'OVERPAID' : 'APPROVED';
  else if (row?.status === 'submitted') status = 'PENDING';
  else if (paid > 0) status = 'PARTIAL';
  else status = 'UNPAID';

  return { status, paidCents: paid, owedCents: owed, creditCents: credit };
}

/**
 * The amount ONE submission on this row is for, in satang — what an approval
 * adds to `paidAmount` and what un-approving it takes back.
 *
 * Rows submitted since Event Funds carry `amount` (the balance owed when
 * they were submitted). Older rows do not: a legacy approved row was a
 * full-fee payment, and a legacy pending/rejected row claims whatever is
 * still owed at the current price.
 */
export function submissionCents(
  row: PaymentLike,
  priceCents: number,
  feeCents: number,
): number {
  if (row.amount != null) return toCents(row.amount);
  if (row.status === 'approved') return feeCents;
  return Math.max(0, priceCents - paidCents(row, feeCents));
}
