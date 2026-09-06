// src/chat/schemas/message.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Group' })
  groupId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  senderId: Types.ObjectId;

  @Prop({ required: true })
  text: string;

  /**
   * Written by `timestamps: true`, declared here because it is read as a
   * value, not just stored: the paginated history sorts on it and encodes it
   * into the cursor. Without the declaration it exists at runtime but not in
   * the type, forcing a cast at every use.
   */
  createdAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

/**
 * Serves the paginated history: `find({groupId, <keyset>}).sort({createdAt:
 * -1, _id: -1})`.
 *
 * `_id` is in the index because it is in the sort — the tiebreaker that makes
 * the ordering total when two messages share a `createdAt` millisecond.
 * Without it Mongo can satisfy the `createdAt` sort from the index but must
 * still sort the ties in memory.
 */
MessageSchema.index({ groupId: 1, createdAt: -1, _id: -1 });
