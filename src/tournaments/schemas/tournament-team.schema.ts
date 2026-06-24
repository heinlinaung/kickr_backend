// src/tournaments/schemas/tournament-team.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TournamentTeamDocument = HydratedDocument<TournamentTeam>;

@Schema({ timestamps: true })
export class TournamentTeam {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  players: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  captainId: Types.ObjectId;
}

export const TournamentTeamSchema = SchemaFactory.createForClass(TournamentTeam);
TournamentTeamSchema.index({ tournamentId: 1 });
