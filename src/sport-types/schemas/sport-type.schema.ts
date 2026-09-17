// src/sport-types/schemas/sport-type.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SportTypeDocument = HydratedDocument<SportType>;

/**
 * A sport a group or event can be about — reference data, replacing the three
 * hardcoded (and mutually inconsistent) sportType enums that used to live on
 * the group schema, the event schema and the event DTOs.
 *
 * Read-only from the API's point of view. Rows are seeded by
 * `scripts/seed-sport-types.ts`, not created by users, so there is no
 * create/update/delete endpoint and no owner field.
 *
 * Groups and events store the `value` string directly — deliberately NOT an
 * ObjectId ref. The value is the datum; this collection only says which values
 * are currently allowed on write.
 */
@Schema({ timestamps: true, collection: 'sporttypes' })
export class SportType {
  /**
   * The value groups/events store, e.g. 'football'. Unique so a re-run of the
   * seeder cannot create a second 'football' — the uniqueness is what makes
   * the seed idempotent. Lowercased to match how the values have always been
   * stored on groups and events.
   */
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  value: string;

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
}

export const SportTypeSchema = SchemaFactory.createForClass(SportType);

/** Serves the only list query: everything, in display order. */
SportTypeSchema.index({ sortOrder: 1, value: 1 });
