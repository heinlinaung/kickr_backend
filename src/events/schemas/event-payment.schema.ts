import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EventPaymentDocument = EventPayment & Document;

/**
 * Whether one member has paid for one event.
 *
 * Its own collection rather than a field on `EventPlayer`, for two reasons:
 * a payment outlives the roster row (someone who pays and then leaves still
 * paid), and the roster row is rewritten by join/leave while a payment record
 * should not be.
 *
 * The amount is deliberately NOT stored here. It lives on the event
 * (`price` + `additionalPrice` when `takeAdditionalPrice` is set), so there is
 * one source of truth for what an event costs; copying it per member would
 * drift the moment an organizer edited the price. This row answers one
 * question only: has this member paid?
 */
@Schema({ timestamps: true })
export class EventPayment {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event', index: true })
  eventId: Types.ObjectId;

  /** The paying member. Named `memberId` for the payment domain; it is a user id. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  memberId: Types.ObjectId;

  @Prop({ default: false })
  isPaid: boolean;

  /**
   * When `isPaid` last became true, for a receipt line.
   * Null while unpaid, and cleared again if a payment is reversed.
   */
  @Prop({ type: Date, default: null })
  paidAt: Date | null;

  /** The organizer who recorded the change — payments are marked, not taken. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  recordedBy: Types.ObjectId | null;
}

export const EventPaymentSchema = SchemaFactory.createForClass(EventPayment);

/**
 * One payment row per member per event.
 *
 * Unique rather than merely indexed: the endpoint upserts, and without this a
 * concurrent double-tap would create two rows for the same member and make
 * "has this member paid?" ambiguous.
 */
EventPaymentSchema.index({ eventId: 1, memberId: 1 }, { unique: true });
