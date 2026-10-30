// src/tournaments/schemas/league-group.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type LeagueGroupDocument = HydratedDocument<LeagueGroup>;

/** A league group (A, B, C…), or the single combined table. */
@Schema({ timestamps: true })
export class LeagueGroup {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'TournamentPhase' })
  phaseId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  order: number;

  /**
   * Standings cache, rebuilt after every result in the group. Standings are
   * derived from confirmed matches; this is never the source of truth.
   */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  standings: unknown[] | null;
}

export const LeagueGroupSchema = SchemaFactory.createForClass(LeagueGroup);
LeagueGroupSchema.index({ phaseId: 1, order: 1 });
