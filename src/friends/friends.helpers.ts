import { Model, Types } from 'mongoose';
import { canJoin, isChallenge } from '../events/events.lifecycle';
import { friendError } from './friends.errors';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Friend requests a user may send per rolling 24 hours. */
export const DAILY_FRIEND_REQUEST_LIMIT = 50;
/** Event invitations a user may send per rolling 24 hours. */
export const DAILY_INVITATION_LIMIT = 200;
/** Invitees per `POST /events/:eventId/invitations`. */
export const MAX_INVITEES_PER_REQUEST = 50;
/** How long a rejected requester waits before asking the same user again. */
export const REJECTION_COOLDOWN_MS = 30 * DAY_MS;

/** Order-free key for a pair of users: "A:B" and "B:A" are the same pair. */
export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Escapes user input so it can be embedded in a RegExp literally. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The card shown for another user in request and friend lists. */
export function userSummary(user: {
  _id: Types.ObjectId;
  name?: string;
  displayName?: string;
  profileImage?: string;
}) {
  return {
    id: user._id.toString(),
    displayName: user.displayName || user.name || null,
    avatarUrl: user.profileImage ?? null,
  };
}

/** When the event kicks off: `startTime` once set, else its `date`. */
export function eventStartsAt(event: {
  date: Date;
  startTime?: Date | null;
}): Date {
  return event.startTime ?? event.date;
}

/**
 * Whether an event still takes invitations: registration open (`join`), not
 * yet started, and not a challenge match — a challenge roster is assigned by
 * the two groups' admins, so a friend cannot be brought in from outside.
 * `cancelled` and `done` fail `canJoin`.
 */
export function isEventOpen(
  event: {
    status: string;
    type?: string | null;
    date: Date;
    startTime?: Date | null;
  },
  now = new Date(),
): boolean {
  return (
    !isChallenge(event.type) &&
    canJoin(event.status) &&
    eventStartsAt(event).getTime() > now.getTime()
  );
}

/**
 * Throws `RATE_LIMITED` when `adding` more rows would take the caller past
 * `limit` in the last 24 hours. `retryAfterSeconds` is when the oldest row in
 * the window falls out of it; HttpExceptionFilter turns it into `Retry-After`.
 */
export async function assertWithinDailyLimit(
  model: Model<any>,
  filter: Record<string, unknown>,
  limit: number,
  adding: number,
  what: string,
): Promise<void> {
  const since = new Date(Date.now() - DAY_MS);
  const windowFilter = { ...filter, createdAt: { $gt: since } };
  const count = await model.countDocuments(windowFilter);
  if (count + adding <= limit) return;

  const oldest = await model
    .findOne(windowFilter)
    .sort({ createdAt: 1 })
    .select('createdAt')
    .lean<{ createdAt: Date }>();
  const retryAfterSeconds = oldest
    ? Math.max(
        1,
        Math.ceil((oldest.createdAt.getTime() + DAY_MS - Date.now()) / 1000),
      )
    : 1;
  throw friendError(
    'RATE_LIMITED',
    `You can send at most ${limit} ${what} per day`,
    { retryAfterSeconds },
  );
}

/** Mongo duplicate-key error — the unique indexes are the race guards. */
export function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

// --- Controller query helpers -----------------------------------------------

export const LIMIT_QUERY = {
  name: 'limit',
  required: false,
  example: 20,
  description: 'Page size, 1-50. Defaults to 20.',
} as const;
export const CURSOR_QUERY = {
  name: 'cursor',
  required: false,
  description:
    'Opaque pagination cursor. Pass `nextCursor` from the previous ' +
    'response verbatim; omit for the first page. Invalid values give 400.',
} as const;

export function toLimit(limit?: string): number | undefined {
  return limit === undefined ? undefined : Number(limit);
}

/** Validates an optional enum query param, or throws `INVALID_REQUEST`. */
export function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) {
    throw friendError(
      'INVALID_REQUEST',
      `${name} must be one of: ${allowed.join(', ')}`,
    );
  }
  return value as T;
}
