// src/finance/schemas/event-settlement.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventSettlementDocument = HydratedDocument<EventSettlement>;

export const SETTLEMENT_STATUSES = ['OPEN', 'SETTLED'] as const;

/**
 * Whether an event's money is locked, and the figures it was locked at.
 *
 * One row per event, keyed by `eventId` (unique). No row reads as OPEN — a
 * row is created by the first write that has to serialise against settling
 * (an expense change, a fee change, settle itself).
 *
 * `revision` is bumped by every such write inside its transaction. That is
 * the concurrency guard: two transactions touching the same document
 * conflict, so an expense added while a settle is in flight aborts one of
 * them instead of slipping past the snapshot.
 *
 * The figure columns are a snapshot taken at settle time, then kept current
 * by late payments and payment reversals (the event stays SETTLED while
 * they arrive).
 */
@Schema({ timestamps: true })
export class EventSettlement {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event', unique: true })
  eventId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Group', index: true })
  groupId: Types.ObjectId;

  @Prop({ required: true, enum: SETTLEMENT_STATUSES, default: 'OPEN' })
  status: string;

  @Prop({ default: 0 })
  revision: number;

  @Prop({ type: Number, default: null })
  collected: number | null;

  @Prop({ type: Number, default: null })
  expenses: number | null;

  /** collected − expenses. */
  @Prop({ type: Number, default: null })
  net: number | null;

  @Prop({ type: Number, default: null })
  outstanding: number | null;

  @Prop({ type: String, default: null })
  note: string | null;

  /**
   * The EVENT_SETTLEMENT fund transaction this settlement posted — what a
   * reopen reverses.
   */
  @Prop({ type: Types.ObjectId, ref: 'GroupFundTransaction', default: null })
  fundTransactionId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  settledBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  settledAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reopenedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reopenedAt: Date | null;

  @Prop({ type: String, default: null })
  reopenReason: string | null;
}

export const EventSettlementSchema =
  SchemaFactory.createForClass(EventSettlement);
// Group summary: "last N settled events, newest first".
EventSettlementSchema.index({ groupId: 1, status: 1, settledAt: -1 });
