// src/tournaments/schemas/tournament-invitation.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TournamentInvitationDocument =
  HydratedDocument<TournamentInvitation>;

export const TOURNAMENT_INVITATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'REVOKED',
  'EXPIRED',
] as const;
export type TournamentInvitationStatus =
  (typeof TOURNAMENT_INVITATION_STATUSES)[number];

/**
 * The organizer's invitation for a Group (club) to enter a team. The group's
 * owner or an admin answers it; accepting registers the team with
 * `clubId` = the group.
 */
@Schema({ timestamps: true })
export class TournamentInvitation {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  /** The invited Group. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'Group' })
  groupId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  invitedBy: Types.ObjectId;

  @Prop({ type: String, default: null, maxlength: 280 })
  message: string | null;

  @Prop({
    type: String,
    required: true,
    enum: TOURNAMENT_INVITATION_STATUSES,
    default: 'PENDING',
  })
  status: TournamentInvitationStatus;

  /** The group owner/admin who accepted or declined. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  respondedBy: Types.ObjectId | null;

  /** When it left `PENDING`. */
  @Prop({ type: Date, default: null })
  respondedAt: Date | null;

  /** The TournamentTeam registered on accept. */
  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  teamId: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const TournamentInvitationSchema =
  SchemaFactory.createForClass(TournamentInvitation);

// At most one open invitation per group per tournament.
TournamentInvitationSchema.index(
  { tournamentId: 1, groupId: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);
// A group's received invitations, newest first.
TournamentInvitationSchema.index({ groupId: 1, status: 1, createdAt: -1 });
// The organizer's sent list.
TournamentInvitationSchema.index({ tournamentId: 1, createdAt: -1 });
