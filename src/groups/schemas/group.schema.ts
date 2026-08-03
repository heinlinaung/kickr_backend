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

  // Where the team is based. Deliberately on the Group rather than derived from
  // Group.locations -> Location: a team's country/city is a property of the team,
  // not of any one pitch it plays on, and GET /events?region= filters on it.
  @Prop({ trim: true })
  country: string;

  @Prop({ trim: true })
  city: string;

  // No cap and no per-entry length limit (product decision) — newlines within an
  // entry are preserved, so do NOT add `trim: true` here or leading/trailing
  // newlines in a rule would be stripped.
  @Prop({ type: [String], default: [] })
  rules: string[];

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
// Supports GET /events?region= resolving groups by country or city.
GroupSchema.index({ country: 1, city: 1 });
