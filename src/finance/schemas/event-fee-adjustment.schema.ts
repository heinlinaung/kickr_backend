// src/finance/schemas/event-fee-adjustment.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventFeeAdjustmentDocument = HydratedDocument<EventFeeAdjustment>;

/**
 * History of per-player price changes (`PATCH /events/:id/fee`). The current
 * value also lives on `Event.updatedPrice` so reads never touch this table;
 * this is the audit trail of how it got there.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class EventFeeAdjustment {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event', index: true })
  eventId: Types.ObjectId;

  /** Price per player in force before this change (baht). */
  @Prop({ required: true })
  previousPrice: number;

  /** New price per player; null = back to the event's own fee. */
  @Prop({ type: Number, default: null })
  updatedPrice: number | null;

  @Prop({ required: true })
  reason: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  createdAt?: Date;
}

export const EventFeeAdjustmentSchema =
  SchemaFactory.createForClass(EventFeeAdjustment);
