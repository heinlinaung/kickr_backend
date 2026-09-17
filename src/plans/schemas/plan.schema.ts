// src/plans/schemas/plan.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlanDocument = HydratedDocument<Plan>;

/**
 * A subscription plan and its limits — reference data, like `sporttypes`.
 *
 * Read-only from the API's point of view. Rows are seeded by
 * `scripts/seed-plans.ts`, not created by users, so there is no
 * create/update/delete endpoint. `User.plan` stores the `name` string —
 * deliberately NOT an ObjectId ref, same reasoning as sportType.
 *
 * Each limit is a number, or **`null` meaning unlimited** — that is how
 * `no-limit-plan` (testing/admin) lifts every cap. PlansService resolves null
 * to Infinity so enforcement sites keep their plain `count >= limit` shape.
 * A limit the document does not carry at all is NOT unlimited: the service
 * falls back to the default plan's value for it, so a half-seeded row
 * degrades to the tightest limits rather than to none.
 */
@Schema({ timestamps: true, collection: 'plans' })
export class Plan {
  /** The value `User.plan` stores, e.g. 'default'. Unique = idempotent seed. */
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  /** Most groups one user may OWN. `null` = unlimited. */
  @Prop({ type: Number, default: null })
  maxGroupsOwned: number | null;

  /** Most events one user may schedule per UTC week. `null` = unlimited. */
  @Prop({ type: Number, default: null })
  maxEventsPerWeek: number | null;

  /** Most photos in one group's gallery. `null` = unlimited. */
  @Prop({ type: Number, default: null })
  maxGalleryPhotosPerGroup: number | null;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);
