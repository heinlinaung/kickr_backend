// src/tournaments/schemas/tournament.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, SchemaTypes } from 'mongoose';
import {
  TOURNAMENT_FORMATS,
  TOURNAMENT_STATUSES,
} from '../tournament.constants';
import type {
  TournamentFormat,
  TournamentSettings,
  TournamentStatus,
} from '../tournament.constants';

export type TournamentDocument = HydratedDocument<Tournament>;

/** An organizer's ruling on a tie no tiebreaker could break. */
export class TieResolution {
  /** The tied teams (TournamentTeam ids), best first. */
  order: Types.ObjectId[];
  reason: string;
  resolvedBy: Types.ObjectId;
  resolvedAt: Date;
}

export class Placement {
  place: number;
  teamId: Types.ObjectId;
}

@Schema({ timestamps: true })
export class Tournament {
  @Prop({ required: true })
  title: string;

  /** The organizer: the only user who can change format, draw or results. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  /** @deprecated Mirrors `format` for older clients. */
  @Prop({ type: String, enum: ['knockout', 'league', 'league_knockout'] })
  type: string;

  @Prop({ type: String, enum: TOURNAMENT_FORMATS, default: 'KNOCKOUT' })
  format: TournamentFormat;

  /** Normalized phase settings: see TournamentSettings. */
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  settings: TournamentSettings;

  @Prop({ required: true })
  maxTeams: number;

  @Prop({ default: 0 })
  currentTeams: number;

  @Prop({
    type: String,
    default: 'REGISTRATION_OPEN',
    enum: TOURNAMENT_STATUSES,
  })
  status: TournamentStatus;

  @Prop({
    type: [
      {
        _id: false,
        order: [{ type: Types.ObjectId, ref: 'TournamentTeam' }],
        reason: String,
        resolvedBy: { type: Types.ObjectId, ref: 'User' },
        resolvedAt: Date,
      },
    ],
    default: [],
  })
  tieResolutions: TieResolution[];

  /** Set when the tournament completes: 1 = champion. */
  @Prop({
    type: [
      {
        _id: false,
        place: Number,
        teamId: { type: Types.ObjectId, ref: 'TournamentTeam' },
      },
    ],
    default: [],
  })
  placements: Placement[];

  @Prop()
  startDate: Date;

  /** How many days the tournament runs, from `startDate` (or creation). */
  @Prop({ type: Number })
  totalDays?: number;

  /**
   * `startDate` (or creation time) + `totalDays`. Once past, the tournament
   * drops out of the active listing and shows in history instead.
   * Absent on tournaments created before `totalDays` existed.
   */
  @Prop({ type: Date, default: null })
  endDate?: Date | null;

  /** How many days registration stays open, from creation. */
  @Prop({ type: Number })
  registerCloseDuration?: number;

  /**
   * Creation time + `registerCloseDuration`. Past it, registration is
   * refused even while the status is still REGISTRATION_OPEN. Cleared when
   * the organizer reopens registration after it passed.
   */
  @Prop({ type: Date, default: null })
  registrationCloseAt?: Date | null;

  /**
   * Short code behind the tournament's QR / share link (`{APP_BASE_URL}/t/{code}`).
   * Minted on the first `GET /tournaments/:id/qr`. It never expires: a printed
   * poster should keep working, and it grants nothing `POST
   * /tournaments/:id/teams` doesn't already allow.
   */
  @Prop({ type: String })
  inviteCode?: string;
}

export const TournamentSchema = SchemaFactory.createForClass(Tournament);

// Sparse: tournaments that never shared a link have no code.
TournamentSchema.index({ inviteCode: 1 }, { unique: true, sparse: true });
// Group listing / history: split on status and endDate, newest first.
TournamentSchema.index({ groupId: 1, endDate: 1, createdAt: -1 });
