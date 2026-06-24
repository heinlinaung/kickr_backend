// src/tournaments/schemas/tournament-match.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TournamentMatchDocument = HydratedDocument<TournamentMatch>;

@Schema({ timestamps: true })
export class TournamentMatch {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ required: true })
  round: number;

  @Prop({ required: true })
  matchNumber: number;

  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  teamAId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  teamBId: Types.ObjectId | null;

  @Prop({ default: 0 })
  scoreA: number;

  @Prop({ default: 0 })
  scoreB: number;

  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  winnerId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'TournamentMatch', default: null })
  nextMatchId: Types.ObjectId | null;

  @Prop()
  scheduledAt: Date;
}

export const TournamentMatchSchema = SchemaFactory.createForClass(TournamentMatch);
