// src/events/schemas/event-player.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventPlayerDocument = HydratedDocument<EventPlayer>;

/** A roster row is either a registered user or a guest brought by one. */
export const EVENT_PLAYER_TYPES = ['registered', 'guest'] as const;
export type EventPlayerType = (typeof EVENT_PLAYER_TYPES)[number];

/**
 * Guest approval state.
 *
 * A SECOND axis from `status`, not a widening of it. The two are orthogonal:
 * an approved guest can still leave (`status: 'cancelled'`), and a pending
 * guest is not on the roster yet. Folding them into one field would make
 * "approved but left" unrepresentable.
 *
 * Registered rows default to `approved`, so a playable query needs no branch on
 * `type` — see `PLAYABLE_APPROVAL` for why it is phrased as an exclusion.
 */
export const GUEST_APPROVALS = ['pending', 'approved', 'rejected'] as const;
export type GuestApproval = (typeof GUEST_APPROVALS)[number];

/**
 * Query fragment for "counts as playing".
 *
 * Excludes the two non-playable states rather than requiring `approved`,
 * because rows written before this field existed have NO `approval` at all —
 * Mongoose defaults apply on write, not on read, so `{ approval: 'approved' }`
 * would silently exclude every pre-existing roster row and empty every event.
 * Phrased as an exclusion, legacy rows pass and no backfill migration is
 * needed.
 */
export const PLAYABLE_APPROVAL = { $nin: ['pending', 'rejected'] } as const;

/** Guests a single member may bring. */
export const MAX_GUESTS_PER_MEMBER = 2;

@Schema({ timestamps: true })
export class EventPlayer {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  /**
   * The registered user this row belongs to — **absent for a guest**, who has
   * no application account by definition.
   *
   * Was `required: true`. Relaxing it is the widest-reaching part of the guest
   * feature: every read that treated this as non-null had to be audited. The
   * alternative — minting a placeholder user per guest — was rejected outright:
   * a guest must never be representable as an application user, or they would
   * leak into auth, search and profiles.
   */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ default: 'registered', enum: EVENT_PLAYER_TYPES })
  type: string;

  /** Display name for a guest. Absent on registered rows, which have a user. */
  @Prop({ trim: true })
  guestName?: string;

  /**
   * The member who brought this guest — their sponsor.
   *
   * Load-bearing rather than informational: it caps guests per member, decides
   * who may withdraw one, and drives the cascade that removes a guest when
   * their sponsor leaves.
   */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  addedByUserId?: Types.ObjectId;

  @Prop({ default: 'approved', enum: GUEST_APPROVALS })
  approval: string;

  @Prop({ sparse: true })
  joinedAt: Date;

  @Prop({ type: String, default: null })
  team: string | null;

  @Prop()
  position: string;

  @Prop({ default: 'joined', enum: ['joined', 'cancelled'] })
  status: string;

  @Prop()
  checkInTime: Date;
}

export const EventPlayerSchema = SchemaFactory.createForClass(EventPlayer);

/**
 * One roster row per registered user per event.
 *
 * `partialFilterExpression` rather than a plain unique index: guests carry no
 * `userId`, so without it every guest on an event would collide with every
 * other on the key `(eventId, null)` and only the first could be inserted.
 * Uniqueness is a rule about registered users, so the index says so.
 */
EventPlayerSchema.index(
  { eventId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $exists: true } } },
);

/** Counting and cascading a sponsor's guests are both per-event lookups. */
EventPlayerSchema.index({ eventId: 1, addedByUserId: 1 });
