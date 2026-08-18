// src/events/schemas/team.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TeamDocument = HydratedDocument<Team>;

/**
 * One team within an event.
 *
 * Its own collection rather than a string on EventPlayer, because a team now
 * carries state of its own — a per-team `duration` that drives how many matches
 * fit in the event, plus a lifecycle `status`. A bare team name could hold
 * neither.
 *
 * Teams are created EMPTY by the generate call and populated afterwards: the
 * client shuffles locally and may hand-edit the result, so assignment is a
 * separate step from creation.
 *
 * `groupId` is denormalised from the event so a group's teams can be listed
 * without joining through events; it is null for events with no group.
 */
@Schema({ timestamps: true })
export class Team {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  @Prop({ required: true, trim: true })
  name: string;

  /** Assigned players. Empty until the organizer assigns them. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  players: Types.ObjectId[];

  /** Minutes this team plays per match — the unit fixtures are built from. */
  @Prop({ required: true, min: 1 })
  duration: number;

  /**
   * Intended squad size for this team.
   *
   * The organizer's target, not a constraint: `players` is filled in a separate
   * step and is NOT validated against this, so a team can sit under or over it
   * while the roster is being edited. The client uses it to show "4/5 assigned"
   * rather than to block a submission.
   */
  @Prop({ required: true, min: 1 })
  numberOfPlayers: number;

  /**
   * `pending` until players are assigned, `ready` once they are. Purely
   * derived from `players` today, but stored so the client can filter without
   * inspecting array lengths.
   */
  @Prop({ default: 'pending', enum: ['pending', 'ready'] })
  status: string;
}

export const TeamSchema = SchemaFactory.createForClass(Team);

// Teams are always read per event, and a name identifies a team within one.
TeamSchema.index({ eventId: 1, name: 1 }, { unique: true });
TeamSchema.index({ groupId: 1 });
