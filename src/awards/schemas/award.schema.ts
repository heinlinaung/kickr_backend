// src/awards/schemas/award.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AwardDocument = HydratedDocument<Award>;

export const AWARD_TYPES = ['MVP', 'GROUP_CHALLENGE'] as const;
export type AwardType = (typeof AWARD_TYPES)[number];

export const AWARD_RECIPIENT_KINDS = ['USER', 'GROUP'] as const;
export type AwardRecipientKind = (typeof AWARD_RECIPIENT_KINDS)[number];

/**
 * One award (spec: Awards).
 *
 *  - `MVP` — one player, one event. Given by the organizer; the recipient is
 *    the USER. Mirrors `event.result.mvpUserId`, which the events service
 *    keeps in sync so the two never disagree.
 *  - `GROUP_CHALLENGE` — the GROUP that won a challenge. Created by the
 *    system when the challenge event reaches `done` with a winner; never by
 *    hand. Members add it to their own profile as a memory (AwardMemory).
 *
 * The display text (`title`, `eventTitle`, `groupName`) is SNAPSHOTTED at
 * award time: deleting a group deletes its events too, and the award must
 * still render on players' profiles afterwards with the names it was won
 * under.
 */
@Schema({ timestamps: true })
export class Award {
  @Prop({ required: true, enum: AWARD_TYPES })
  type: string;

  @Prop({ required: true, enum: AWARD_RECIPIENT_KINDS })
  recipientKind: string;

  /** User id for MVP, group id for Group Challenge. */
  @Prop({ required: true, type: Types.ObjectId })
  recipientId: Types.ObjectId;

  /** The event the award was given for — MVP's event, or the challenge match. */
  @Prop({ type: Types.ObjectId, ref: 'Event', default: null })
  eventId: Types.ObjectId | null;

  /** Set for Group Challenge only. */
  @Prop({ type: Types.ObjectId, ref: 'Challenge', default: null })
  challengeId: Types.ObjectId | null;

  @Prop({ required: true })
  title: string;

  @Prop({ type: String, default: null })
  note: string | null;

  /** The event title at award time — the event may be deleted later. */
  @Prop({ type: String, default: null })
  eventTitle: string | null;

  /** Group Challenge: the winning group's name at award time. */
  @Prop({ type: String, default: null })
  groupName: string | null;

  /** The organizer who gave it; null when the system did (Group Challenge). */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  awardedBy: Types.ObjectId | null;

  @Prop({ required: true, type: Date })
  awardedAt: Date;

  /**
   * Group Challenge: who may add it as a memory — the winning side's players
   * who were approved members of the group when it was awarded. Frozen here
   * so leaving the group later does not change the answer, and so a member
   * who joins afterwards does not inherit a win they were not part of.
   */
  @Prop({ type: [Types.ObjectId], default: [] })
  eligibleUserIds: Types.ObjectId[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const AwardSchema = SchemaFactory.createForClass(Award);

// One MVP per event, one Group Challenge award per challenge — the races
// (double submit, double `done`) end at the index, not in application code.
AwardSchema.index(
  { eventId: 1 },
  { unique: true, partialFilterExpression: { type: 'MVP' } },
);
AwardSchema.index(
  { challengeId: 1 },
  { unique: true, partialFilterExpression: { type: 'GROUP_CHALLENGE' } },
);
// Awards tabs: a recipient's awards, newest first, keyset-paged.
AwardSchema.index({ recipientKind: 1, recipientId: 1, awardedAt: -1, _id: -1 });
