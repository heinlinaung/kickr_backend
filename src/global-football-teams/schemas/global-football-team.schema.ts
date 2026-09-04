// src/global-football-teams/schemas/global-football-team.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GlobalFootballTeamDocument =
  HydratedDocument<GlobalFootballTeam>;

/**
 * A real-world football club, for reference data — the list a user picks their
 * supported team from. **Not** a KickR team: those are `Team`, created per
 * event and holding a roster.
 *
 * Read-only from the API's point of view. Rows are seeded by
 * `scripts/seed-global-football-teams.ts`, not created by users, so there is no
 * create/update/delete endpoint and no owner field.
 */
@Schema({ timestamps: true, collection: 'globalfootballteams' })
export class GlobalFootballTeam {
  /**
   * Club name as displayed. Unique so a re-run of the seeder cannot create a
   * second "Arsenal" — the uniqueness is what makes the seed idempotent.
   */
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  /**
   * Display position, driving the default ordering.
   *
   * Separate from `name` because the intended order is not alphabetical (the
   * seed list is by league standing, so Manchester United precedes Arsenal).
   * Separate from `_id` because an ObjectId's order is creation order, which
   * would make reordering mean re-inserting.
   *
   * Not unique: two clubs sharing a position is a display quirk, not a data
   * error, and enforcing it would make an intentional reshuffle a multi-step
   * migration.
   */
  @Prop({ required: true })
  sortOrder: number;
}

export const GlobalFootballTeamSchema = SchemaFactory.createForClass(
  GlobalFootballTeam,
);

/**
 * Serves the only query this collection has: everything, in display order.
 *
 * `name` is the tiebreaker so the ordering is total — without it, rows sharing
 * a `sortOrder` come back in whatever order the storage engine chooses, which
 * can differ between identical requests.
 */
GlobalFootballTeamSchema.index({ sortOrder: 1, name: 1 });
