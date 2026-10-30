// src/tournaments/schemas/qualification-result.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type QualificationResultDocument = HydratedDocument<QualificationResult>;

/** A team that went through from the league phase, mixed format only. */
@Schema({ timestamps: true })
export class QualificationResult {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'TournamentTeam' })
  teamId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'LeagueGroup' })
  fromGroupId: Types.ObjectId;

  /** Position in its group. */
  @Prop({ required: true })
  rank: number;

  /** Seed in the bracket, 1 = top seed. */
  @Prop({ required: true })
  seed: number;

  /** A1, B2…; just the rank for one combined table. */
  @Prop({ required: true })
  seedLabel: string;

  /** 0 = group winners, 1 = runners-up…; the last tier is best of rest. */
  @Prop({ required: true })
  tier: number;

  /** Set when an organizer ruling placed this team. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolvedBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  reason: string | null;
}

export const QualificationResultSchema =
  SchemaFactory.createForClass(QualificationResult);
QualificationResultSchema.index(
  { tournamentId: 1, teamId: 1 },
  { unique: true },
);
