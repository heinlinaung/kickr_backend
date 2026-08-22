import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { FOOTBALL_POSITIONS, PROFILE_VISIBILITY } from '../profile.constants';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  cognitoSub: string;

  @Prop({ required: true })
  name: string;

  @Prop({ unique: true, sparse: true })
  username: string;

  @Prop()
  displayName: string;

  @Prop({ required: true, unique: true, lowercase: true })
  email: string;

  @Prop()
  phoneNumber: string;

  @Prop()
  height: number;

  @Prop()
  weight: number;

  @Prop()
  profileImage: string;

  @Prop()
  profileImageFileId: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop()
  biography: string;

  // Lowercase for the same reason as Group.country — one canonical form, so
  // comparisons and future grouping do not depend on how the user typed it.
  @Prop({ trim: true, lowercase: true })
  country: string;

  @Prop({ trim: true, lowercase: true })
  city: string;

  @Prop()
  dateOfBirth: Date;

  @Prop({ type: [String], default: [] })
  sports: string[];

  @Prop()
  preferredSport: string;

  @Prop({ enum: [...FOOTBALL_POSITIONS] })
  footballPosition: string;

  @Prop(
    raw({
      profileVisibility: {
        type: String,
        enum: [...PROFILE_VISIBILITY],
        default: 'public',
      },
      showStats: { type: Boolean, default: true },
      showMatchHistory: { type: Boolean, default: true },
    }),
  )
  privacy: {
    profileVisibility: string;
    showStats: boolean;
    showMatchHistory: boolean;
  };

  @Prop({ unique: true, sparse: true })
  inviteCode: string;

  @Prop({ type: [String], default: [] })
  highlightVideos: string[];

  @Prop({ type: [String], default: [] })
  gallery: string[];
}

export const UserSchema = SchemaFactory.createForClass(User);

export const USER_SENSITIVE_PROJECTION = '-__v';

UserSchema.set('toJSON', {
  versionKey: false,
});
