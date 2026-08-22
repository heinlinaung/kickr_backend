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
  //
  // Stored LOWERCASE. `?region=` matches these values, and mixed casing made
  // that filter silently miss: a group saved as "Yangon" was invisible to
  // `?region=yangon`. Normalising on write means one canonical form in the
  // database rather than a case-insensitive comparison at every read site.
  // Free text for now — no country/city reference list exists yet.
  @Prop({ trim: true, lowercase: true })
  country: string;

  @Prop({ trim: true, lowercase: true })
  city: string;

  /**
   * Free-form rules text.
   *
   * Was `string[]` (one entry per rule); now a single block of text, so the
   * client owns presentation entirely instead of the API imposing a bullet
   * structure. `scripts/migrate-group-rules-to-text.ts` joins existing arrays
   * with newlines.
   *
   * Deliberately NO `trim: true`: newlines are meaningful here, and trimming
   * would strip leading/trailing ones. The client must render with
   * `white-space: pre-line` (or split on `\n`) or the text collapses into one
   * paragraph — the most likely way this looks broken while the API is correct.
   */
  @Prop({ type: String, default: '' })
  rules: string;

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
