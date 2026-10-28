// src/friends/schemas/friendship.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FriendshipDocument = HydratedDocument<Friendship>;

export const FRIENDSHIP_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];

/** Statuses that occupy the pair — at most one such row per two users. */
export const ACTIVE_FRIENDSHIP_STATUSES: readonly FriendshipStatus[] = [
  'PENDING',
  'ACCEPTED',
];

/**
 * One row per friend request; the same row becomes the friendship once it is
 * approved. Unfriending deletes the `ACCEPTED` row. `REJECTED` rows stay, since
 * they drive the 30-day cooldown on asking again.
 */
@Schema({ timestamps: true })
export class Friendship {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  requesterId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  addresseeId: Types.ObjectId;

  /**
   * The two user ids sorted and joined (`pairKeyOf`), so "A↔B" and "B↔A" are
   * the same key. Mongo cannot index LEAST/GREATEST, so the order-free pair is
   * stored instead.
   */
  @Prop({ required: true })
  pairKey: string;

  @Prop({
    type: String,
    required: true,
    enum: FRIENDSHIP_STATUSES,
    default: 'PENDING',
  })
  status: FriendshipStatus;

  /**
   * True while `PENDING` or `ACCEPTED`. Exists only for the unique index
   * below: a partial filter on a boolean `$eq` works on every Mongo version,
   * where `status: { $in: [...] }` does not.
   */
  @Prop({ required: true, default: true })
  active: boolean;

  /** When approved, rejected or cancelled; null while pending. */
  @Prop({ type: Date, default: null })
  respondedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);

// One live request-or-friendship per pair; concurrent sends end here.
FriendshipSchema.index(
  { pairKey: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
// Incoming / outgoing request lists and "my friends".
FriendshipSchema.index({ addresseeId: 1, status: 1, createdAt: -1 });
FriendshipSchema.index({ requesterId: 1, status: 1, createdAt: -1 });
