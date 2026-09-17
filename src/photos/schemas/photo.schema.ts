// src/photos/schemas/photo.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PhotoDocument = HydratedDocument<Photo>;

/**
 * What a photo is attached to.
 *
 * Open-ended on purpose — `tournament` is listed now so adding one later is a
 * value, not a schema change. Only `group` and `event` have routes today.
 */
export const PHOTO_TARGETS = ['group', 'event', 'tournament'] as const;
export type PhotoTarget = (typeof PHOTO_TARGETS)[number];

/**
 * Most photos one NON-GROUP target (event, tournament) may hold.
 *
 * A group's own photos are governed by its owner's plan instead — the gallery
 * cap in `plans.ts`, which also counts the group's events' photos. See
 * `PhotosService.add`.
 */
export const MAX_PHOTOS_PER_TARGET = 30;

/**
 * One uploaded image, attached to a group, an event, or (later) a tournament.
 *
 * A single polymorphic collection rather than an array embedded on each owner:
 *
 * - An event photo has to appear in its GROUP's gallery. With embedded arrays
 *   that means reading two differently-shaped documents and merging them; here
 *   it is one query with an `$or`.
 * - A document array grows without bound inside the parent, and every read of
 *   the event carries every photo whether the caller wanted them or not.
 * - Adding a third owner type costs a value here, not a new field on a new
 *   schema.
 *
 * `targetType` + `targetId` rather than three nullable foreign keys: the pair
 * is always exactly one thing, and a row cannot be half-attached to two owners.
 */
@Schema({ timestamps: true })
export class Photo {
  @Prop({ required: true, enum: PHOTO_TARGETS })
  targetType: string;

  /**
   * The owning group/event/tournament.
   *
   * Deliberately NOT a `ref`: it points at a different collection depending on
   * `targetType`, so a single `ref` would be wrong two times in three, and
   * `populate()` on it would silently resolve against the wrong model.
   */
  @Prop({ required: true, type: Types.ObjectId })
  targetId: Types.ObjectId;

  /**
   * The group this photo also belongs to, for an EVENT photo.
   *
   * Denormalised so the group gallery is one indexed query rather than "find
   * the group's events, then find photos for each". It is set at upload time
   * from `event.groupId`, and is `null` for a standalone event's photos — those
   * have no group to appear in — and for a group's own photos, where
   * `targetId` already says it.
   *
   * The cost is that moving an event between groups would strand it, which the
   * API does not allow: `groupId` cannot be changed by PATCH /events/:id.
   */
  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  @Prop({ required: true })
  url: string;

  /** ImageKit's handle, needed to delete the remote file. */
  @Prop({ required: true })
  fileId: string;

  /**
   * Who uploaded it.
   *
   * The embedded `EventPhoto` recorded only `{url, fileId}`, so there was no
   * way to attribute a photo or to let an uploader manage their own. Recorded
   * from the start here, even though only owners/admins can upload today —
   * adding it later would leave every existing row unattributable.
   */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  uploadedBy: Types.ObjectId;

  createdAt: Date;
}

export const PhotoSchema = SchemaFactory.createForClass(Photo);

/**
 * The gallery read: everything for one target, newest first.
 *
 * `_id` is in the index because it is in the sort — the tiebreaker that makes
 * the order total when several photos are uploaded in the same millisecond,
 * which a multi-file upload will do.
 */
PhotoSchema.index({ targetType: 1, targetId: 1, createdAt: -1, _id: -1 });

/**
 * The group gallery, which spans the group's own photos AND its events'.
 *
 * Without this the `$or` across `targetId` and `groupId` would scan.
 */
PhotoSchema.index({ groupId: 1, createdAt: -1, _id: -1 });
