// src/events/schemas/event.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { EVENT_STATUSES } from '../events.lifecycle';

export type EventDocument = HydratedDocument<Event>;

/**
 * Fixtures used to be embedded here as `matches[]`. They now live in their own
 * collection — see `./event-match.schema.ts` — so each has a stable `_id` that
 * player ratings (spec §8) can reference. `scripts/extract-event-matches.ts`
 * migrates existing embedded arrays across.
 */

/** An after-match photo. `fileId` is kept so the file can be deleted. */
@Schema({ _id: false })
export class EventPhoto {
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  fileId: string;
}

export const EventPhotoSchema = SchemaFactory.createForClass(EventPhoto);

/**
 * Overall result. `scoreA`/`scoreB` are for simple 2-team events only.
 *
 * The MVP pair is written by `POST /events/:id/mvp` (2026-09-19 — it moved
 * out of `POST /events/:id/result`, which now records only the score); the
 * two endpoints preserve each other's fields, so either can be submitted
 * first or re-submitted alone.
 */
@Schema({ _id: false })
export class EventResult {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  mvpUserId: Types.ObjectId | null;

  /**
   * Goals scored by the MVP. `null` on results recorded before the field
   * existed — "not reported", not zero.
   */
  @Prop({ type: Number, default: null })
  mvpGoal: number | null;

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

  /**
   * A plain value from the `sporttypes` collection (seeded by
   * `scripts/seed-sport-types.ts`) — deliberately NOT an ObjectId ref. No
   * schema-level enum: the old inline lists here, on the group schema and in
   * the DTOs had already drifted apart, so the collection is now the single
   * source of truth and the services validate writes against it.
   *
   * A grouped event does not choose this: an event with a `groupId` always
   * carries its GROUP's sportType. EventsService copies it on create, rejects
   * a conflicting value on update, and propagates a group sportType change to
   * every event under the group. Only a standalone event (`groupId: null`)
   * sets it freely.
   */
  @Prop({ default: 'football' })
  sportType: string;

  /**
   * The format of a FOOTBALL event: `futsal` or `stadium`.
   *
   * Only meaningful when the sport has formats at all — the allowed values
   * are the `subTypes` of this event's sportType row in the `sporttypes`
   * collection, and only football has any. The create/update paths reject a
   * subType the row does not carry, so it cannot be set on a futsal or padel
   * event where it would mean nothing. A football GROUP's events keep
   * `sportType: 'football'` and pick their format here.
   *
   * `null` by default, which is what every event created before this field
   * existed reads as: the organizer did not say. Treat it as "unspecified",
   * NOT as a synonym for stadium.
   *
   * ⚠️ Note the overlap: `futsal` is ALSO a top-level `sportType`, here and on
   * groups and user profiles. So an event can be `sportType: 'futsal'` or
   * `sportType: 'football'` + `subType: 'futsal'`, and nothing reconciles the
   * two. That was accepted deliberately — the alternative was a breaking
   * migration of existing futsal events — but a client filtering for futsal
   * must check both.
   */
  @Prop({ type: String, default: null })
  subType: string | null;

  @Prop({ default: 'beginner', enum: ['beginner', 'intermediate', 'advanced'] })
  skillLevel: string;

  @Prop({ default: 0 })
  price: number;

  /**
   * A surcharge on top of `price`, charged only when `takeAdditionalPrice` is
   * true.
   *
   * Kept as its own field rather than folded into `price` so the base fee and
   * the surcharge stay separately reportable — a client can show "20 + 5" and
   * the organizer can switch the surcharge off without losing its amount.
   */
  @Prop({ default: 0, min: 0 })
  additionalPrice: number;

  /**
   * Whether `additionalPrice` actually applies.
   *
   * Separate from the amount being non-zero so an organizer can keep a
   * configured surcharge and toggle it off between events without retyping it.
   */
  @Prop({ default: false })
  takeAdditionalPrice: boolean;

  /**
   * Whether members may bring guests (`+1` / `+2`) to this event.
   *
   * Defaults to **false**: a capability switch stays off until an organizer
   * asks for it. That also makes the rollout safe without a migration — events
   * created before this field existed have no value, which reads as false, so
   * no event silently starts accepting guests.
   *
   * Only gates ADDING a guest. Flipping it off later does not remove guests
   * already approved, in the same way that closing registration does not
   * expel players who already joined.
   */
  @Prop({ default: false })
  isAllowExtraPlayer: boolean;

  /**
   * Lifecycle state (spec §4.1). Replaces the old `open|full|done`.
   * There is no `full` — capacity is derived via the `isFull` virtual.
   */
  @Prop({ default: 'join', enum: EVENT_STATUSES })
  status: string;

  /**
   * Why the event was cancelled — the message players see. Written only by
   * `POST /events/:id/cancel` together with `status: 'cancelled'`; `null` on
   * every live event. Never editable afterwards: the cancellation is a
   * record, and canModify() is false once it exists.
   */
  @Prop({ type: String, default: null })
  cancelReason: string | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  /** Which organizer called it off — cheap to record now, unattributable later. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  cancelledBy: Types.ObjectId | null;

  /**
   * The status the event held when it was cancelled, so
   * `POST /events/:id/restore` can put a wrongly-cancelled event BACK rather
   * than reset it — a match cancelled mid-`playing` resumes as `playing`,
   * not at registration. Cleared (with the fields above) on restore.
   */
  @Prop({ type: String, default: null })
  statusBeforeCancel: string | null;

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

  /**
   * Total event length in MINUTES, minimum 60.
   *
   * Drives fixture generation: the schedule is built from
   * `(duration - MATCH_BUFFER_MINUTES) / team.duration`, so a match list can
   * never overrun the time actually booked (spec §4.3.4).
   */
  @Prop({ default: 90, min: 60 })
  duration: number;

  /**
   * How long before kick-off registration closes, in **MINUTES**.
   *
   * Distinct from `duration` above, which is how long the event RUNS. Same
   * unit, opposite direction: `duration` measures forward from the start,
   * this measures backward from it.
   *
   *   registrationClosingDuration: 120  ->  registration closes 2h before
   *   registrationClosingDuration: 0    ->  open right up to kick-off
   *
   * `0` is the default because it is the previous behaviour: an event created
   * before this field existed has no value, and "registration never closes
   * early" is what that should read as.
   *
   * Stored as an OFFSET rather than an absolute closing timestamp, so moving
   * the event moves the deadline with it instead of leaving a stale one behind.
   */
  @Prop({ default: 0, min: 0 })
  registrationClosingDuration: number;

  @Prop({ type: String, default: null })
  coverImage: string | null;

  /** ImageKit fileId for `coverImage`, needed to delete on replace. */
  @Prop({ type: String, default: null })
  coverImageFileId: string | null;

  /**
   * @deprecated Photos moved to the shared `photos` collection on 2026-09-13,
   * so an event's photo can also appear in its group's gallery without being
   * copied. Nothing reads or writes this any more — use
   * `GET /events/:id/photos`, which is served by `PhotosService`.
   *
   * Kept only so any pre-existing documents are not silently orphaned by a
   * schema change. Safe to drop once a query confirms no event still carries
   * one; `scripts/` is the place for that check.
   */
  @Prop({ type: [EventPhotoSchema], default: [] })
  photos: EventPhoto[];

  @Prop({ type: EventResultSchema, default: null })
  result: EventResult | null;

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
