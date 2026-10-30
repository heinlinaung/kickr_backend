// src/tournaments/schemas/tournament-phase.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { PHASE_STATUSES, PHASE_TYPES } from '../tournament.constants';
import type { PhaseStatus, PhaseType } from '../tournament.constants';

export type TournamentPhaseDocument = HydratedDocument<TournamentPhase>;

/** One per phase the format uses: LEAGUE (order 1) and/or KNOCKOUT. */
@Schema({ timestamps: true })
export class TournamentPhase {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: PHASE_TYPES })
  type: PhaseType;

  @Prop({ required: true })
  order: number;

  @Prop({ type: String, enum: PHASE_STATUSES, default: 'PENDING' })
  status: PhaseStatus;

  /** That phase's slice of Tournament.settings, frozen at start. */
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  settings: Record<string, unknown>;

  /** League: set by the group draw. */
  @Prop({ type: Date, default: null })
  drawnAt: Date | null;

  /** Knockout: the organizer reviewed and confirmed the bracket. */
  @Prop({ type: Date, default: null })
  bracketConfirmedAt: Date | null;

  /** Knockout: first-round pairs still matching two teams from one group. */
  @Prop({ type: [Number], default: [] })
  bracketClashes: number[];
}

export const TournamentPhaseSchema =
  SchemaFactory.createForClass(TournamentPhase);
TournamentPhaseSchema.index({ tournamentId: 1, type: 1 }, { unique: true });
