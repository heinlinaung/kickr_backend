// src/tournaments/schemas/tournament-match.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  MATCH_SIDES,
  MATCH_STATUSES,
  PHASE_TYPES,
} from '../tournament.constants';
import type {
  MatchSide,
  MatchStatus,
  PhaseType,
} from '../tournament.constants';

export type TournamentMatchDocument = HydratedDocument<TournamentMatch>;

export class MatchCards {
  yellow: number;
  red: number;
}

const CardsSchema = {
  _id: false,
  yellow: { type: Number, default: 0 },
  red: { type: Number, default: 0 },
};

/**
 * A league fixture or a knockout match. Teams are TournamentTeam ids
 * (registrations). A two-legged knockout tie is two rows: leg 2 points back
 * at leg 1 and carries the tie's `winnerTo`.
 */
@Schema({ timestamps: true })
export class TournamentMatch {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'TournamentPhase' })
  phaseId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: PHASE_TYPES })
  stage: PhaseType;

  /** League only. */
  @Prop({ type: Types.ObjectId, ref: 'LeagueGroup', default: null })
  groupId: Types.ObjectId | null;

  /** League only: round-robin round. */
  @Prop({ type: Number, default: null })
  matchday: number | null;

  /** Knockout only. */
  @Prop({ type: Types.ObjectId, ref: 'KnockoutRound', default: null })
  roundId: Types.ObjectId | null;

  /** Knockout: position in the round, from 1. */
  @Prop({ type: Number, default: null })
  slot: number | null;

  @Prop({ default: 1 })
  leg: number;

  @Prop({ type: Types.ObjectId, ref: 'TournamentMatch', default: null })
  firstLegMatchId: Types.ObjectId | null;

  /** Play order across the whole phase. */
  @Prop({ default: 0 })
  sequence: number;

  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  homeTeamId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  awayTeamId: Types.ObjectId | null;

  /** Seed labels such as A1 / B2, knockout round one only. */
  @Prop({ type: String, default: null })
  homeSeed: string | null;

  @Prop({ type: String, default: null })
  awaySeed: string | null;

  /** The home team goes straight through; there is no away team. */
  @Prop({ default: false })
  isBye: boolean;

  @Prop({ type: Number, default: null })
  homeGoals: number | null;

  @Prop({ type: Number, default: null })
  awayGoals: number | null;

  @Prop({ type: Number, default: null })
  penHome: number | null;

  @Prop({ type: Number, default: null })
  penAway: number | null;

  @Prop({
    type: { _id: false, home: CardsSchema, away: CardsSchema },
    default: null,
  })
  cards: { home: MatchCards; away: MatchCards } | null;

  /** The side that forfeited or didn't show (3–0 / walkover). */
  @Prop({ type: String, enum: [...MATCH_SIDES, null], default: null })
  forfeit: MatchSide | null;

  @Prop({ type: String, enum: MATCH_STATUSES, default: 'SCHEDULED' })
  status: MatchStatus;

  /** Knockout: the tie's winner once decided. */
  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  winnerTeamId: Types.ObjectId | null;

  /** Where the winner goes: always the next tie's first (or only) leg. */
  @Prop({ type: Types.ObjectId, ref: 'TournamentMatch', default: null })
  winnerToMatchId: Types.ObjectId | null;

  @Prop({ type: String, enum: [...MATCH_SIDES, null], default: null })
  winnerToSide: MatchSide | null;

  /** Semi-finals with a third-place match: where the loser goes. */
  @Prop({ type: Types.ObjectId, ref: 'TournamentMatch', default: null })
  loserToMatchId: Types.ObjectId | null;

  @Prop({ type: String, enum: [...MATCH_SIDES, null], default: null })
  loserToSide: MatchSide | null;

  @Prop({ type: Date, default: null })
  kickoffAt: Date | null;

  @Prop({ type: Date, default: null })
  resultAt: Date | null;
}

export const TournamentMatchSchema =
  SchemaFactory.createForClass(TournamentMatch);
TournamentMatchSchema.index({ tournamentId: 1, stage: 1, sequence: 1 });
TournamentMatchSchema.index({ phaseId: 1, groupId: 1 });
TournamentMatchSchema.index({ roundId: 1, slot: 1 });
