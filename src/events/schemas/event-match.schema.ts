// src/events/schemas/event-match.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventMatchDocument = HydratedDocument<EventMatch>;

/**
 * One fixture in a multi-team event.
 *
 * Its own collection rather than an array on Event, so each fixture has a
 * stable `_id` that other collections can reference — player ratings (spec §8)
 * hang off a specific match, and an embedded subdocument gives them nothing
 * durable to point at. It also lets fixtures be queried across events
 * ("everything kicking off this weekend") without loading whole events.
 *
 * Scores are `null` until entered — NOT 0, which is a real scoreline. Standings
 * skip any fixture with a null score on either side, so the distinction is
 * load-bearing rather than cosmetic.
 */
@Schema({ timestamps: true })
export class EventMatch {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  /** 1..N within the event, assigned at generation time. */
  @Prop({ required: true })
  matchNumber: number;

  @Prop({ required: true })
  teamA: string;

  @Prop({ required: true })
  teamB: string;

  @Prop({ type: Number, default: null })
  scoreA: number | null;

  @Prop({ type: Number, default: null })
  scoreB: number | null;

  @Prop({ type: Date, default: null })
  playedAt: Date | null;
}

export const EventMatchSchema = SchemaFactory.createForClass(EventMatch);

// The fixture list is always read per event in match order.
EventMatchSchema.index({ eventId: 1, matchNumber: 1 }, { unique: true });
// Cross-event fixture queries — "what is being played this weekend".
EventMatchSchema.index({ playedAt: -1 });
