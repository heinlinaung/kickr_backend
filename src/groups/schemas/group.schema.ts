// src/groups/schemas/group.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GroupDocument = HydratedDocument<Group>;

@Schema({ timestamps: true })
export class Group {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  ownerId: Types.ObjectId;

  @Prop()
  wallpaper: string;

  @Prop()
  locationName: string;

  @Prop()
  latitude: number;

  @Prop()
  longitude: number;

  @Prop({ default: false })
  isPrivate: boolean;

  @Prop({ default: 22 })
  maxPlayers: number;

  @Prop()
  inviteCode: string;

  @Prop()
  inviteCodeExpiry: Date;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
GroupSchema.index({ inviteCode: 1 }, { unique: true, sparse: true });
