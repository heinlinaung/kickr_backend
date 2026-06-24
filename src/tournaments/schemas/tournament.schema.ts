// src/tournaments/schemas/tournament.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TournamentDocument = HydratedDocument<Tournament>;

@Schema({ timestamps: true })
export class Tournament {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  @Prop({ required: true, enum: ['knockout', 'league'] })
  type: string;

  @Prop({ required: true })
  maxTeams: number;

  @Prop({ default: 0 })
  currentTeams: number;

  @Prop({ default: 'registering', enum: ['registering', 'ongoing', 'finished'] })
  status: string;

  @Prop()
  startDate: Date;
}

export const TournamentSchema = SchemaFactory.createForClass(Tournament);
