// src/events/events.lifecycle.ts
/**
 * Event lifecycle — the transition table and its guards.
 *
 * Pure module: no Mongoose, no Nest, no I/O. Everything here is a total
 * function over plain values so the rules can be unit-tested exhaustively
 * (every legal AND illegal pair) without a database.
 *
 * The 6 states replace the old `open|full|done` trio. Capacity is no longer a
 * status — a full event stays in `join` and `isFull` is derived on read.
 */

export const EVENT_STATUSES = [
  'join',
  'preparation',
  'ready_to_play',
  'playing',
  'after_match',
  'done',
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * Legal transitions, per spec §4.1.
 *
 * `before_match` was removed: it sat between `join` and `preparation` without
 * gating anything of its own — the same actions were permitted either side of
 * it — so closing registration and starting team assignment are now one step.
 *
 * `ready_to_play` was added between `preparation` and `playing`. It is NOT a
 * repeat of that mistake: it gates something the neighbouring states do not.
 * Teams are built and shuffled in `preparation`; here they are final and only
 * viewable, and the match has not kicked off, so no score can be entered
 * either. It is the window where everyone confirms the line-up.
 *
 * That is also why `preparation -> playing` is gone. A state that can be
 * bypassed is decoration, and the roster freeze only means something if
 * kick-off has to pass through it.
 *
 * Two reverse edges:
 *  - `preparation -> join` reopens registration after backing out of team
 *    assignment. Absorbs what `preparation -> before_match -> join` used to do.
 *  - `ready_to_play -> preparation` sends a reviewed-but-wrong team set back to
 *    be re-shuffled. Safe in a way no later reverse edge would be: scoring
 *    cannot have started, so nothing can be discarded by going back.
 *
 * There is deliberately no edge out of `done` — archival is terminal.
 */
const TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> = {
  join: ['preparation'],
  preparation: ['ready_to_play', 'join'],
  ready_to_play: ['playing', 'preparation'],
  playing: ['after_match'],
  after_match: ['done'],
  done: [],
};

/** True when `value` is one of the six lifecycle states. */
export function isEventStatus(value: unknown): value is EventStatus {
  return (
    typeof value === 'string' && EVENT_STATUSES.includes(value as EventStatus)
  );
}

/**
 * True when `from -> to` is a legal move.
 *
 * A self-transition (`join -> join`) is NOT legal: it is never a meaningful
 * request, and rejecting it keeps the caller honest about no-op PATCHes.
 * Unknown states return false rather than throwing — callers validate input
 * separately and a bad value should read as "not allowed", not crash.
 */
export function canTransition(from: unknown, to: unknown): boolean {
  if (!isEventStatus(from) || !isEventStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/** The states reachable from `from`; empty for terminal or unknown states. */
export function allowedTransitions(from: unknown): readonly EventStatus[] {
  return isEventStatus(from) ? TRANSITIONS[from] : [];
}

// --- Action gates (spec §4.1) -------------------------------------------
// Each gate answers "does the lifecycle permit this action right now?" and
// nothing else. Capacity, ownership and existence are checked by the caller —
// keeping those out means these stay pure predicates over a status.

/** Registration is open only in `join`. Capacity is checked separately. */
export function canJoin(status: unknown): boolean {
  return status === 'join';
}

/** Leaving is allowed only while registration is open. */
export function canLeave(status: unknown): boolean {
  return status === 'join';
}

/**
 * Teams and fixtures are submitted during `preparation` only.
 *
 * Deliberately excludes `ready_to_play`: freezing the roster is that state's
 * entire purpose. Widening this gate would make the two states equivalent and
 * reduce `ready_to_play` to a label.
 */
export function canShuffle(status: unknown): boolean {
  return status === 'preparation';
}

/** Scores can be entered once play starts, and corrected after the whistle. */
export function canEnterScore(status: unknown): boolean {
  return status === 'playing' || status === 'after_match';
}

/** MVP, photos and the result summary belong to `after_match`. */
export function canSubmitResult(status: unknown): boolean {
  return status === 'after_match';
}

/** Organizers may edit or delete an event until it is archived. */
export function canModify(status: unknown): boolean {
  return isEventStatus(status) && status !== 'done';
}
