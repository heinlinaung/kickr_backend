// src/sport-types/schemas/sport-type.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SportTypeDocument = HydratedDocument<SportType>;

/**
 * A sport a group or event can be about — reference data, replacing the three
 * hardcoded (and mutually inconsistent) sportType enums that used to live on
 * the group schema, the event schema and the event DTOs.
 *
 * Seeded by `scripts/seed-sport-types.ts` and maintained through the
 * superadmin-only write endpoints on /sport-types — never by end users, so
 * there is no owner field.
 *
 * Groups and events store the `value` string directly — deliberately NOT an
 * ObjectId ref. The value is the datum; this collection only says which values
 * are currently allowed on write.
 */
@Schema({ timestamps: true, collection: 'sporttypes' })
export class SportType {
  /**
   * The sport's ID — the value groups/events/users store, e.g. 'football'.
   * Unique so a re-run of the seeder cannot create a second 'football' — the
   * uniqueness is what makes the seed idempotent. Lowercased to match how the
   * values have always been stored on groups and events.
   *
   * Immutable once created: renaming the sport changes `name` only, so no
   * document holding this value ever has to move.
   */
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  value: string;

  /**
   * Display label, e.g. 'Football'. Free to change — nothing stores it.
   * Unique case-insensitively (checked in the service, not by an index, so
   * rows from before this field existed don't collide on a missing name).
   * Rows without one read as their `value`.
   */
  @Prop({ trim: true })
  name: string;

  /**
   * The formats this sport can be played in, e.g. football's
   * `['futsal', 'stadium']`. Empty for sports with no formats — an event of
   * such a sport must not carry a `subType` at all.
   */
  @Prop({ type: [String], default: [] })
  subTypes: string[];

  /**
   * Display position, driving the default ordering. Separate from `_id`
   * because an ObjectId's order is creation order, which would make
   * reordering mean re-inserting.
   */
  @Prop({ required: true })
  sortOrder: number;

  /**
   * Whether an event of this sport is played as a match. Clients use it to
   * decide whether the event detail screen shows the match timeline (kick-off,
   * score entry, result). Defaults to true — every seeded sport is played as
   * a match, so existing rows keep the timeline they already showed.
   */
  @Prop({ default: true })
  matchProvided: boolean;
}

export const SportTypeSchema = SchemaFactory.createForClass(SportType);

/** Serves the only list query: everything, in display order. */
SportTypeSchema.index({ sortOrder: 1, value: 1 });
