// src/ratings/schemas/rating.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RatingDocument = HydratedDocument<Rating>;

/**
 * What a rating is attached to (spec §4.10).
 *
 * `player` targets a USER id — a player is a user seen through their event
 * participation, not a separate collection.
 */
export const RATING_TARGETS = ['player', 'event', 'group'] as const;
export type RatingTarget = (typeof RATING_TARGETS)[number];

export const MIN_STARS = 1;
export const MAX_STARS = 5;
export const MAX_RATING_DESCRIPTION = 500;

/**
 * Event statuses at which the event (and its players) can be rated.
 *
 * Deliberately NOT `FINISHED_STATUSES` from the lifecycle: that set includes
 * `cancelled`, and a match that never happened has no experience to rate.
 */
export const RATABLE_EVENT_STATUSES = ['after_match', 'done'] as const;

/**
 * One user's rating of one player, event, or group.
 *
 * A single polymorphic collection, same shape and same reasons as `Photo`:
 * `targetType` + `targetId` rather than three nullable foreign keys, and a
 * new ratable thing later is a value here, not a schema.
 *
 * `raterId` is ALWAYS stored, even for an anonymous rating. Anonymity is a
 * DISPLAY rule, not a storage rule: without the id there is no way to enforce
 * one rating per user per target, and the author could never edit or delete
 * their own review. Masking happens at read time in the service.
 */
@Schema({ timestamps: true })
export class Rating {
  @Prop({ required: true, enum: RATING_TARGETS })
  targetType: string;

  /**
   * The rated user/event/group.
   *
   * Deliberately NOT a `ref`: it points at a different collection depending
   * on `targetType`, so a single `ref` would be wrong two times in three.
   */
  @Prop({ required: true, type: Types.ObjectId })
  targetId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  raterId: Types.ObjectId;

  @Prop({ required: true, min: MIN_STARS, max: MAX_STARS })
  stars: number;

  /** Optional written review; null rather than '' so "no text" is one value. */
  @Prop({ type: String, default: null, maxlength: MAX_RATING_DESCRIPTION })
  description: string | null;

  @Prop({ default: false })
  isAnonymous: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const RatingSchema = SchemaFactory.createForClass(Rating);

// One rating per user per target — the DB-level backstop for what the
// service's upsert already implies. A race between two first submissions
// collapses to one row instead of two.
RatingSchema.index(
  { raterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);

// The list and summary queries: everything for one target, newest first.
RatingSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
