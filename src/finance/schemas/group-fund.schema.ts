// src/finance/schemas/group-fund.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GroupFundDocument = HydratedDocument<GroupFund>;

/**
 * A group's fund balance — a CACHE of its ledger, never edited directly.
 *
 * The truth is `group_fund_transactions`; this row is the running sum, moved
 * only by `$inc` in the same transaction that inserts a ledger row. Every
 * posting writes this document first, which is also the "lock": two
 * concurrent postings to one group conflict here and one retries.
 *
 * Invariant: balance = totalIncome − totalExpenses.
 */
@Schema({ timestamps: { createdAt: false, updatedAt: true } })
export class GroupFund {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Group', unique: true })
  groupId: Types.ObjectId;

  @Prop({ default: 0 })
  balance: number;

  @Prop({ default: 0 })
  totalIncome: number;

  @Prop({ default: 0 })
  totalExpenses: number;

  updatedAt?: Date;
}

export const GroupFundSchema = SchemaFactory.createForClass(GroupFund);
