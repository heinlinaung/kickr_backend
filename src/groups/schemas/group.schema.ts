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
  wallpaperFileId: string;

  @Prop()
  logo: string;

  @Prop()
  logoFileId: string;

  @Prop({ enum: ['football', 'futsal', 'padel', 'basketball'] })
  sportType: string;

  @Prop({ trim: true })
  handle: string;

  @Prop({ type: [String], default: [] })
  teamRules: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Location' }], default: [] })
  locations: Types.ObjectId[];

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
GroupSchema.index({ handle: 1 }, { unique: true, sparse: true });
GroupSchema.index({ name: 'text' });
