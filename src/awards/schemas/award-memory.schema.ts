// src/awards/schemas/award-memory.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AwardMemoryDocument = HydratedDocument<AwardMemory>;

/**
 * A group award a player chose to show on their own profile (spec: Awards).
 *
 * The award stays under the group; this row only says "show it on my Awards
 * tab too". Deleting it removes it from that one profile and leaves the
 * group's award alone. Leaving the group does NOT delete it.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AwardMemory {
  /** Always a `GROUP_CHALLENGE` award. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'Award' })
  awardId: Types.ObjectId;

  /** The profile it appears on. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  createdAt?: Date;
}

export const AwardMemorySchema = SchemaFactory.createForClass(AwardMemory);

// Each user adds a given award once; the index also serves "my memories".
AwardMemorySchema.index({ userId: 1, awardId: 1 }, { unique: true });
