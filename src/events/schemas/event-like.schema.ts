// src/events/schemas/event-like.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventLikeDocument = HydratedDocument<EventLike>;

/**
 * One like, by one user, on one event (spec §4.5).
 *
 * A row per like rather than an array on Event: it keeps `likedByMe` a cheap
 * indexed lookup and avoids an unbounded array on the event document.
 * `Event.likeCount` is the denormalised counter kept in step with these rows.
 */
@Schema({ timestamps: true })
export class EventLike {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;
}

export const EventLikeSchema = SchemaFactory.createForClass(EventLike);

// Unique so liking twice is a no-op rather than a double count — the
// idempotency in spec §6 is enforced here, not just in the service.
EventLikeSchema.index({ eventId: 1, userId: 1 }, { unique: true });
