import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { FOOTBALL_POSITIONS, PROFILE_VISIBILITY } from '../profile.constants';

export type UserDocument = HydratedDocument<User>;

/** Platforms a device token can come from. */
export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

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

  /**
   * Registered push targets — one row per device, not one token per user.
   *
   * An array because a single account is routinely signed in on more than one
   * device, and a reinstall issues a fresh token without invalidating the old
   * one immediately. Overwriting a single field would silence every device but
   * the most recent, and give no way to deregister just one on logout.
   *
   * Tokens are pruned when FCM reports them unregistered — otherwise this
   * array only ever grows, and every send wastes calls on dead targets.
   *
   * NOT part of any public projection: a device token is a push credential, so
   * it is excluded from user search, public profiles and the member list the
   * same way email is.
   */
  @Prop({
    type: [
      {
        fcmToken: { type: String, required: true },
        platform: { type: String, enum: DEVICE_PLATFORMS, required: true },
        updatedAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    default: [],
  })
  devices: { fcmToken: string; platform: string; updatedAt: Date }[];

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

/**
 * Fields stripped from every read of the caller's own user document.
 *
 * `devices` is excluded because an FCM token is a push credential: anyone
 * holding one can send notifications to that device. It is also attached to
 * `request.user` by the JWT strategy, so without this exclusion every
 * authenticated request would carry the caller's push tokens around, and
 * `GET /users/me` would hand them back over the wire.
 *
 * The client never needs to read them — it holds the token already, and only
 * ever POSTs it to `/notifications/devices`.
 */
export const USER_SENSITIVE_PROJECTION = '-__v -devices';

UserSchema.set('toJSON', {
  versionKey: false,
});
