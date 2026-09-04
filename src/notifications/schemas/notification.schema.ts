// src/notifications/schemas/notification.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ required: true, enum: ['event', 'group'] })
  type: string;

  @Prop({ type: String })
  refId: string;

  @Prop({ default: false })
  isRead: boolean;

  /**
   * Written by `timestamps: true`, declared here because it is read as a
   * value, not just stored: the paginated feed sorts on it and encodes it into
   * the cursor. Without the declaration it exists at runtime but not in the
   * type, forcing a cast at every use.
   */
  createdAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

/**
 * Serves the paginated feed: `find({userId, <keyset>}).sort({createdAt: -1,
 * _id: -1})`.
 *
 * `_id` is in the index because it is in the sort — it is the tiebreaker that
 * makes the ordering total across notifications created in the same fan-out
 * millisecond. Without it Mongo can satisfy the `createdAt` sort from the index
 * but must still sort the ties in memory.
 */
NotificationSchema.index({ userId: 1, createdAt: -1, _id: -1 });

/**
 * Kept for the unread badge (`countDocuments({userId, isRead: false})`) and
 * `markAllRead`, which still filter on `isRead`. It no longer serves the list
 * query — that stopped sorting by `isRead` when the endpoint became paginated,
 * because a mutable sort key moves rows between pages.
 */
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
