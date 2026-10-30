// src/tournaments/schemas/tournament-team.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { REGISTRATION_STATUSES } from '../tournament.constants';
import type { RegistrationStatus } from '../tournament.constants';

export type TournamentTeamDocument = HydratedDocument<TournamentTeam>;

/**
 * A team's registration in one tournament. Matches, groups and qualification
 * point here rather than at a Group's team, so tournament results never touch
 * the team itself.
 */
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

  /** The Group (club) the team comes from; drives `separateSameClub`. */
  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  clubId: Types.ObjectId | null;

  /** Rows without a status predate approval and count as APPROVED. */
  @Prop({ type: String, enum: REGISTRATION_STATUSES, default: 'APPROVED' })
  status: RegistrationStatus;

  @Prop({ type: Date, default: null })
  withdrawnAt: Date | null;
}

export const TournamentTeamSchema =
  SchemaFactory.createForClass(TournamentTeam);
TournamentTeamSchema.index({ tournamentId: 1 });
