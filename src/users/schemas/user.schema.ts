import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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

  @Prop({ default: false })
  emailVerified: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

export const USER_SENSITIVE_PROJECTION = '-__v';

UserSchema.set('toJSON', {
  versionKey: false,
});
