// src/groups/schemas/group-member.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GroupMemberDocument = HydratedDocument<GroupMember>;

@Schema({ timestamps: true })
export class GroupMember {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Group' })
  groupId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ default: 'member', enum: ['owner', 'admin', 'member'] })
  role: string;

  @Prop({ default: 'pending', enum: ['pending', 'approved'] })
  status: string;

  @Prop()
  joinedAt: Date;
}

export const GroupMemberSchema = SchemaFactory.createForClass(GroupMember);
GroupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });
