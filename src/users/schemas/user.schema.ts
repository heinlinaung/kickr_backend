import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

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

  @Prop({ default: 'player', enum: ['player', 'owner'] })
  role: string;

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
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    const record = ret as unknown as Record<string, unknown>;
    delete record['passwordHash'];
    delete record['emailVerificationToken'];
    delete record['passwordResetToken'];
    delete record['passwordResetExpiry'];
    return record;
  },
});
