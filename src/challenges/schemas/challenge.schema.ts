// src/challenges/schemas/challenge.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChallengeDocument = HydratedDocument<Challenge>;

export const CHALLENGE_STATUSES = ['proposed', 'accepted', 'rejected'] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

/**
 * One group challenging another to a match (spec: Group Challenge).
 *
 * The handshake lives here; the MATCH lives on an Event. Strictly one event
 * per challenge — `eventId` is stamped when the proposal event is created,
 * and a rematch is a NEW challenge, so the history of who challenged whom
 * stays one row per occasion.
 *
 * Flow: challenger's owner/admin creates (status `proposed`) → challenged
 * side's owner/admin accepts or rejects (optional reason). Only an ACCEPTED
 * challenge can grow its proposal event.
 */
@Schema({ timestamps: true })
export class Challenge {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Group' })
  challengerGroupId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Group' })
  challengedGroupId: Types.ObjectId;

  @Prop({ required: true, enum: CHALLENGE_STATUSES, default: 'proposed' })
  status: string;

  /** Why the challenged side said no; null otherwise. */
  @Prop({ type: String, default: null })
  rejectReason: string | null;

  /** The challenger-side admin who issued it. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  respondedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  respondedAt: Date | null;

  /** The one proposal event; null until it is created. One challenge, one event. */
  @Prop({ type: Types.ObjectId, ref: 'Event', default: null })
  eventId: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ChallengeSchema = SchemaFactory.createForClass(Challenge);

// A group's challenge list reads both directions; status rides along for the
// pending-duplicate guard.
ChallengeSchema.index({ challengerGroupId: 1, status: 1 });
ChallengeSchema.index({ challengedGroupId: 1, status: 1 });
