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

/**
 * Formats a FOOTBALL event can take.
 *
 * Lives here beside `EVENT_STATUSES` so the enum has one definition shared by
 * the schema, both DTOs and the service guard — four copies of a string list
 * is how they drift.
 *
 * Only meaningful when `sportType` is `'football'`. Note `futsal` is also a
 * top-level sportType; see the note on `Event.subType`.
 */
export const FOOTBALL_SUB_TYPES = ['futsal', 'stadium'] as const;

export type FootballSubType = (typeof FOOTBALL_SUB_TYPES)[number];

/**
 * The lifecycle is sport-aware: FOOTBALL events keep the full six states, and
 * every other sport skips `preparation` — team assignment for them happens in
 * `ready_to_play` (see `canShuffle`), so a separate build stage gated nothing.
 *
 * `EVENT_STATUSES` stays the SUPERSET (= the football list). It is what the
 * schema enum and query-filter validation accept, because a status filter must
 * be able to name any state a stored event can be in — including a football
 * event's `preparation` — regardless of which sport the caller browses.
 */
export const FOOTBALL_EVENT_STATUSES = [
  'join',
  'preparation',
  'ready_to_play',
  'playing',
  'after_match',
  'done',
] as const;

export const EVENT_STATUSES = FOOTBALL_EVENT_STATUSES;

export type EventStatus = (typeof EVENT_STATUSES)[number];

/** The lifecycle for every sport but football: no `preparation`. */
export const NON_FOOTBALL_EVENT_STATUSES = [
  'join',
  'ready_to_play',
  'playing',
  'after_match',
  'done',
] as const satisfies readonly EventStatus[];

/**
 * True when `sportType` runs the football lifecycle.
 *
 * A missing value (undefined/null) counts as football: the schema default is
 * 'football', so the only documents without the field are ones hydrated
 * outside Mongoose defaults (`.lean()` on pre-field rows) — and those predate
 * every other sport.
 */
export function isFootball(sportType: unknown): boolean {
  return sportType == null || sportType === 'football';
}

/** The status list for a sport, in lifecycle order. */
export function statusesFor(sportType: unknown): readonly EventStatus[] {
  return isFootball(sportType)
    ? FOOTBALL_EVENT_STATUSES
    : NON_FOOTBALL_EVENT_STATUSES;
}

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
const FOOTBALL_TRANSITIONS: Readonly<
  Record<EventStatus, readonly EventStatus[]>
> = {
  join: ['preparation'],
  preparation: ['ready_to_play', 'join'],
  ready_to_play: ['playing', 'preparation'],
  playing: ['after_match'],
  after_match: ['done'],
  done: [],
};

/**
 * Non-football table: `preparation` is cut out and its edges rewired —
 * `join -> ready_to_play` directly, and the reverse edge lands back in `join`
 * (reopening registration) instead of a build stage that does not exist.
 *
 * `preparation` still has EXIT rows even though nothing can enter it: a group
 * changing sport away from football (applyGroupSportType) can leave an event
 * already sitting there, and a state with no exits would strand it. The exits
 * mirror football's, so such an event escapes forward or back but cannot be
 * re-entered.
 */
const NON_FOOTBALL_TRANSITIONS: Readonly<
  Record<EventStatus, readonly EventStatus[]>
> = {
  join: ['ready_to_play'],
  preparation: ['ready_to_play', 'join'],
  ready_to_play: ['playing', 'join'],
  playing: ['after_match'],
  after_match: ['done'],
  done: [],
};

/** The transition table for a sport. */
function transitionsFor(
  sportType: unknown,
): Readonly<Record<EventStatus, readonly EventStatus[]>> {
  return isFootball(sportType) ? FOOTBALL_TRANSITIONS : NON_FOOTBALL_TRANSITIONS;
}

/**
 * States that mean the fixture is over.
 *
 * `after_match` sits here with `done` because the match has been played — it is
 * the window for entering the result, not a fixture anyone can still turn up
 * to. A discovery or "ongoing" list showing either is showing history.
 *
 * Named once rather than inlined as a `$nin` at each call site, so the two
 * lists cannot drift on what "finished" means.
 */
export const FINISHED_STATUSES: readonly EventStatus[] = [
  'after_match',
  'done',
];

/** True when the fixture has been played. */
export function isFinished(status: unknown): boolean {
  return FINISHED_STATUSES.includes(status as EventStatus);
}

/** True when `value` is one of the six lifecycle states. */
export function isEventStatus(value: unknown): value is EventStatus {
  return (
    typeof value === 'string' && EVENT_STATUSES.includes(value as EventStatus)
  );
}

/**
 * True when `from -> to` is a legal move for the event's sport.
 *
 * A self-transition (`join -> join`) is NOT legal: it is never a meaningful
 * request, and rejecting it keeps the caller honest about no-op PATCHes.
 * Unknown states return false rather than throwing — callers validate input
 * separately and a bad value should read as "not allowed", not crash.
 *
 * `sportType` omitted means football, which is also every caller written
 * before the lifecycle became sport-aware.
 */
export function canTransition(
  from: unknown,
  to: unknown,
  sportType?: unknown,
): boolean {
  if (!isEventStatus(from) || !isEventStatus(to)) return false;
  return transitionsFor(sportType)[from].includes(to);
}

/** The states reachable from `from`; empty for terminal or unknown states. */
export function allowedTransitions(
  from: unknown,
  sportType?: unknown,
): readonly EventStatus[] {
  return isEventStatus(from) ? transitionsFor(sportType)[from] : [];
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
 * Teams and fixtures are submitted during the sport's BUILD stage.
 *
 * Football builds in `preparation` and deliberately not in `ready_to_play`:
 * freezing the roster is that state's entire purpose there, and widening the
 * gate would make the two states equivalent.
 *
 * Every other sport has no `preparation`, so `ready_to_play` absorbs the
 * build role — it is the only state between registration and kick-off, and
 * gating on a state the sport cannot reach would make teams impossible.
 */
export function canShuffle(status: unknown, sportType?: unknown): boolean {
  return status === buildStageFor(sportType);
}

/** The state a sport builds teams in — for gate checks and error messages. */
export function buildStageFor(sportType: unknown): EventStatus {
  return isFootball(sportType) ? 'preparation' : 'ready_to_play';
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
