import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EventPaymentDocument = EventPayment & Document;

export const PAYMENT_METHODS = ['cash', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * A row exists only once the member SUBMITS — "unpaid" is the absence of a
 * row, same convention as before the submit/review flow replaced organizer
 * marking (2026-10-03).
 */
export const PAYMENT_STATUSES = ['submitted', 'approved', 'rejected'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * One member's payment claim for one event, and what the cashier made of it.
 *
 * The flow: the member submits (cash: a bare claim; bank transfer: with a
 * receipt screenshot), the group's cashier — or the event creator for
 * non-group events — approves or rejects after checking. A rejected member
 * may resubmit, which overwrites this same row; the unique index below is
 * what makes "one claim per member per event" hold under concurrency.
 *
 * Its own collection rather than a field on `EventPlayer`, for the original
 * reasons: a payment outlives the roster row, and the roster row is
 * rewritten by join/leave while a payment record should not be.
 *
 * The amount is deliberately NOT stored. It lives on the event (`price` +
 * `additionalPrice` when `takeAdditionalPrice` is set), so there is one
 * source of truth for what an event costs.
 */
@Schema({ timestamps: true })
export class EventPayment {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event', index: true })
  eventId: Types.ObjectId;

  /** The paying member. Named `memberId` for the payment domain; it is a user id. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  memberId: Types.ObjectId;

  @Prop({ required: true, enum: PAYMENT_METHODS })
  method: string;

  @Prop({ required: true, enum: PAYMENT_STATUSES, default: 'submitted' })
  status: string;

  /**
   * The bank-transfer receipt screenshot; always null for cash. Replaced
   * (and the old file deleted) when the member resubmits.
   */
  @Prop({ type: String, default: null })
  proofUrl: string | null;

  @Prop({ type: String, default: null })
  proofFileId: string | null;

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  /** The cashier (or creator) who last reviewed; null while submitted. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  /** Why a rejection happened — shown to the member; null otherwise. */
  @Prop({ type: String, default: null })
  rejectReason: string | null;
}

export const EventPaymentSchema = SchemaFactory.createForClass(EventPayment);

/**
 * One payment row per member per event.
 *
 * Unique rather than merely indexed: submission upserts, and without this a
 * concurrent double-tap would create two rows for the same member and make
 * "has this member paid?" ambiguous.
 */
EventPaymentSchema.index({ eventId: 1, memberId: 1 }, { unique: true });
