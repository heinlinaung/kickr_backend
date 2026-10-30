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
