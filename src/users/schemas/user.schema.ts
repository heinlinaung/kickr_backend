import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ unique: true, sparse: true })
  username: string;

  @Prop()
  displayName: string;

  @Prop({ required: true, unique: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop()
  phoneNumber: string;

  @Prop()
  height: number;

  @Prop()
  weight: number;

  @Prop()
  profileImage: string;

  @Prop({ type: [String], default: [] })
  joinedGroups: string[];

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop()
  emailVerificationToken: string;

  @Prop()
  passwordResetToken: string;

  @Prop()
  passwordResetExpiry: Date;

  @Prop({ default: 0 })
  refreshTokenVersion: number;
}

export const UserSchema = SchemaFactory.createForClass(User);

export const USER_SENSITIVE_PROJECTION = '-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiry';

UserSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    const record = ret as unknown as Record<string, unknown>;
    delete record['passwordHash'];
    delete record['emailVerificationToken'];
    delete record['passwordResetToken'];
    delete record['passwordResetExpiry'];
    delete record['refreshTokenVersion'];
    return record;
  },
});
