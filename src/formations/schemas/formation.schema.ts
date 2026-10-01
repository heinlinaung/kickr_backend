// src/formations/schemas/formation.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FormationDocument = HydratedDocument<Formation>;

/**
 * The suggested formations for one squad size — reference data feeding the
 * client's formation picker ("11P Formation": 4-4-2, 4-3-3, …).
 *
 * Read-only from the API, seeded by `scripts/seed-formations.ts`, same
 * pattern as `sporttypes` and `plans`. Deliberately NOT what the server
 * validates a team's formation against: setting a formation is free-form
 * (the arithmetic is checked, not list membership), so adding a shape here
 * widens the picker without gating anyone.
 */
@Schema({ timestamps: true, collection: 'formations' })
export class Formation {
  /** Display label, e.g. "11P Formation". */
  @Prop({ required: true, trim: true })
  name: string;

  /**
   * Goalkeeper included — "4-4-2" lives under playerCount 11. Unique: one
   * row per squad size is what makes the seeder idempotent.
   */
  @Prop({ required: true, unique: true })
  playerCount: number;

  /** The shapes, e.g. ['4-4-2', '4-3-3'] — outfield lines only. */
  @Prop({ type: [String], default: [] })
  formation: string[];
}

export const FormationSchema = SchemaFactory.createForClass(Formation);
