// src/tournaments/schemas/league-group-team.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LeagueGroupTeamDocument = HydratedDocument<LeagueGroupTeam>;

@Schema({ timestamps: true })
export class LeagueGroupTeam {
  @Prop({ required: true, type: Types.ObjectId, ref: 'TournamentPhase' })
  phaseId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'LeagueGroup' })
  groupId: Types.ObjectId;

  /** The TournamentTeam (registration), not the Group's team. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'TournamentTeam' })
  teamId: Types.ObjectId;

  /** Seeded draw only: 1 = strongest pot. */
  @Prop({ type: Number, default: null })
  pot: number | null;

  @Prop({ required: true })
  drawOrder: number;
}

export const LeagueGroupTeamSchema =
  SchemaFactory.createForClass(LeagueGroupTeam);
LeagueGroupTeamSchema.index({ phaseId: 1, teamId: 1 }, { unique: true });
LeagueGroupTeamSchema.index({ groupId: 1, drawOrder: 1 });
