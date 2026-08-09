// src/events/schemas/event-team-chat.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventTeamChatDocument = HydratedDocument<EventTeamChat>;

/**
 * One chat room per colour team on an event (spec §4.3.2).
 *
 * Created when teams are submitted and archived when the event reaches `done`.
 * Keyed by team NAME rather than an index because the name is what fixtures,
 * notifications and the client all refer to; renaming a team means resubmitting
 * the roster, which recreates the rooms (spec §4.3.4 rule 5).
 */
@Schema({ timestamps: true })
export class EventTeamChat {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ required: true })
  team: string;

  /** Set on `done`; archived rooms stay readable as history. */
  @Prop({ default: false })
  archived: boolean;
}

export const EventTeamChatSchema = SchemaFactory.createForClass(EventTeamChat);

// One room per team per event. Upserting on this key makes resubmission
// idempotent — the same team name keeps its existing room and its messages.
EventTeamChatSchema.index({ eventId: 1, team: 1 }, { unique: true });
