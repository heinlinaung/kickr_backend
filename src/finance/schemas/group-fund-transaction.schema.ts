// src/finance/schemas/group-fund-transaction.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GroupFundTransactionDocument =
  HydratedDocument<GroupFundTransaction>;

/**
 * EVENT_SETTLEMENT   ± an event's net, posted by settle
 * LATE_PAYMENT       + a payment approved after its event was settled
 * SETTLEMENT_REVERSAL  the opposite of the settlement it undoes (reopen)
 * PAYMENT_REVERSAL   − an approved payment on a settled event rejected
 */
export const FUND_TRANSACTION_TYPES = [
  'EVENT_SETTLEMENT',
  'LATE_PAYMENT',
  'SETTLEMENT_REVERSAL',
  'PAYMENT_REVERSAL',
] as const;
export type FundTransactionType = (typeof FUND_TRANSACTION_TYPES)[number];

/**
 * One immutable ledger row. Rows are only ever inserted — a correction is a
 * new, opposite row — so the history is complete by construction.
 *
 * `balanceAfter` is the fund balance right after this row, read back from
 * the `$inc` on GroupFund inside the same transaction, so it is exact
 * without summing the ledger on every read.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class GroupFundTransaction {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Group' })
  groupId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Event', default: null })
  eventId: Types.ObjectId | null;

  @Prop({ required: true, enum: FUND_TRANSACTION_TYPES })
  type: string;

  /** Signed baht. */
  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  balanceAfter: number;

  @Prop({ type: String, default: null })
  note: string | null;

  /** The paying member, for LATE_PAYMENT / PAYMENT_REVERSAL rows. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  memberId: Types.ObjectId | null;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  createdAt?: Date;
}

export const GroupFundTransactionSchema =
  SchemaFactory.createForClass(GroupFundTransaction);
// History: newest first, keyset-paged on (createdAt, _id).
GroupFundTransactionSchema.index({ groupId: 1, createdAt: -1, _id: -1 });
// Per-event contribution sums (settle / resettle).
GroupFundTransactionSchema.index({ eventId: 1 });
