// src/events/schemas/team.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TeamDocument = HydratedDocument<Team>;

/**
 * Roles a player can hold inside a team.
 *
 * `player` is the default and is never stored — absence from `playerRoles`
 * means `player`, so the common case costs nothing and cannot drift.
 */
export const TEAM_MEMBER_ROLES = ['player', 'captain'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];
export const DEFAULT_TEAM_MEMBER_ROLE: TeamMemberRole = 'player';

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

  /**
   * Approved GUESTS assigned to this team, by their roster-row id.
   *
   * A separate field because `players` references `User` and a guest has no
   * account — there is no user id to put in that array, and minting one would
   * make a guest representable as an application user. So membership of a team
   * is the union of `players` (registered) and `guests` (roster rows).
   *
   * Referencing `EventPlayer` rather than a name string keeps the link to the
   * approval state and the sponsor, so a team read can still tell who brought
   * this person and whether they are still approved.
   */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'EventPlayer' }], default: [] })
  guests: Types.ObjectId[];

  /**
   * Per-player roles within this team. Only NON-default roles are stored, so
   * a player absent from this list is a plain `player`.
   *
   * `players` deliberately stays a flat id array rather than becoming
   * `[{ userId, role }]`. That would be the tidier domain model — one source
   * of truth — but `players` is populated straight into user objects by
   * `GET /events/:id/teams`, so reshaping it changes the response for every
   * existing client, and the assign path, notifications and the shuffle all
   * read it as ids. Annotating is the cheaper half of that trade; the cost is
   * that the two fields have to be kept consistent, which
   * `assignTeamPlayers` does by pruning roles for players who left the team.
   */
  @Prop({
    type: [
      {
        userId: { type: Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: TEAM_MEMBER_ROLES, required: true },
        _id: false,
      },
    ],
    default: [],
  })
  playerRoles: { userId: Types.ObjectId; role: string }[];

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
