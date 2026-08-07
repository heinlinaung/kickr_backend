// src/events/schemas/event.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { EVENT_STATUSES } from '../events.lifecycle';

export type EventDocument = HydratedDocument<Event>;

/**
 * One fixture in a multi-team event. Embedded on Event (no own `_id`) because
 * the fixture list is fixed at shuffle time and only ever read or written as
 * part of its event.
 *
 * Scores are `null` until entered — NOT 0, which is a real scoreline. Standings
 * skip any fixture with a null score on either side, so the distinction is
 * load-bearing rather than cosmetic.
 */
@Schema({ _id: false })
export class EventMatch {
  @Prop({ required: true })
  matchNumber: number;

  @Prop({ required: true })
  teamA: string;

  @Prop({ required: true })
  teamB: string;

  @Prop({ type: Number, default: null })
  scoreA: number | null;

  @Prop({ type: Number, default: null })
  scoreB: number | null;

  @Prop({ type: Date, default: null })
  playedAt: Date | null;
}

export const EventMatchSchema = SchemaFactory.createForClass(EventMatch);

/** An after-match photo. `fileId` is kept so the file can be deleted. */
@Schema({ _id: false })
export class EventPhoto {
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  fileId: string;
}

export const EventPhotoSchema = SchemaFactory.createForClass(EventPhoto);

/** Overall result. `scoreA`/`scoreB` are for simple 2-team events only. */
@Schema({ _id: false })
export class EventResult {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  mvpUserId: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  scoreA: number | null;

  @Prop({ type: Number, default: null })
  scoreB: number | null;
}

export const EventResultSchema = SchemaFactory.createForClass(EventResult);

@Schema({ timestamps: true })
export class Event {
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  @Prop({ default: false })
  isPublic: boolean;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Location', default: null })
  locationId: Types.ObjectId | null;

  @Prop({ default: 12 })
  maxPlayers: number;

  @Prop({ default: 0 })
  joinedCount: number;

  @Prop({ default: 'football', enum: ['football', 'futsal'] })
  sportType: string;

  @Prop({ default: 'beginner', enum: ['beginner', 'intermediate', 'advanced'] })
  skillLevel: string;

  @Prop({ default: 0 })
  price: number;

  /**
   * Lifecycle state (spec §4.1). Replaces the old `open|full|done`.
   * There is no `full` — capacity is derived via the `isFull` virtual.
   */
  @Prop({ default: 'join', enum: EVENT_STATUSES })
  status: string;

  // --- Fields landed by build-order step 1, filled by steps 2-3 ------------
  // These ship empty so the status migration is the only pass over every
  // event document. Presence here does NOT mean the behaviour exists yet.

  @Prop({ type: Date, default: null })
  startTime: Date | null;

  @Prop({ type: Date, default: null })
  endTime: Date | null;

  /** How many colour teams the organizer intends to split into. */
  @Prop({ default: 4, min: 2, max: 6 })
  teamCount: number;

  @Prop({ type: String, default: null })
  coverImage: string | null;

  /** ImageKit fileId for `coverImage`, needed to delete on replace. */
  @Prop({ type: String, default: null })
  coverImageFileId: string | null;

  @Prop({ type: [EventPhotoSchema], default: [] })
  photos: EventPhoto[];

  @Prop({ type: EventResultSchema, default: null })
  result: EventResult | null;

  /** Fixtures, submitted by the client during `preparation` (spec §4.3). */
  @Prop({ type: [EventMatchSchema], default: [] })
  matches: EventMatch[];

  @Prop({ type: Types.ObjectId, ref: 'EventTemplate', default: null })
  templateId: Types.ObjectId | null;

  /** Denormalised counter for the EventLike collection. */
  @Prop({ default: 0 })
  likeCount: number;
}

export const EventSchema = SchemaFactory.createForClass(Event);
EventSchema.index({ groupId: 1, date: 1 });
EventSchema.index({ isPublic: 1, date: 1 });
EventSchema.index({ createdBy: 1, date: -1 });
// Lifecycle-filtered listing, e.g. "open events, soonest first".
EventSchema.index({ status: 1, date: 1 });

/**
 * Capacity is derived, never stored — there is no `full` status to drift out
 * of sync with `joinedCount`. Declared as a virtual so it rides along on
 * `toJSON`/`toObject` reads.
 *
 * NOTE: virtuals do not exist on `.lean()` results. Service reads that use
 * lean() compute this explicitly; see EventsService.
 */
EventSchema.virtual('isFull').get(function (this: {
  joinedCount?: number;
  maxPlayers?: number;
}) {
  return (this.joinedCount ?? 0) >= (this.maxPlayers ?? 0);
});

EventSchema.set('toJSON', { virtuals: true });
EventSchema.set('toObject', { virtuals: true });
