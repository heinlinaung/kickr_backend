// src/friends/schemas/event-invitation.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventInvitationDocument = HydratedDocument<EventInvitation>;

export const EVENT_INVITATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'REVOKED',
  'EXPIRED',
] as const;
export type EventInvitationStatus = (typeof EVENT_INVITATION_STATUSES)[number];

/**
 * A friend's invitation to join one event.
 *
 * Unrelated to the challenge-event `invited` roster rows on EventPlayer — those
 * are admin assignments within a group. This one needs only a friendship:
 * the invitee does not have to belong to the event's group.
 */
@Schema({ timestamps: true })
export class EventInvitation {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  inviterId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  inviteeId: Types.ObjectId;

  @Prop({ type: String, default: null, maxlength: 280 })
  message: string | null;

  @Prop({
    type: String,
    required: true,
    enum: EVENT_INVITATION_STATUSES,
    default: 'PENDING',
  })
  status: EventInvitationStatus;

  /** When it left `PENDING`. */
  @Prop({ type: Date, default: null })
  respondedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EventInvitationSchema =
  SchemaFactory.createForClass(EventInvitation);

// At most one open invitation per user per event, whoever sent it.
EventInvitationSchema.index(
  { eventId: 1, inviteeId: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);
// "Invitations I received", newest first, keyset-paged.
EventInvitationSchema.index({
  inviteeId: 1,
  status: 1,
  createdAt: -1,
  _id: -1,
});
// The inviter's daily send limit.
EventInvitationSchema.index({ inviterId: 1, createdAt: -1 });
