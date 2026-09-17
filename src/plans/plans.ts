// src/plans/plans.ts
/**
 * Plans — what a user's subscription tier allows.
 *
 * Pure module: no Mongoose, no Nest, no I/O — same reasoning as
 * `events.lifecycle.ts`. The plan DEFINITIONS live in the `plans` collection
 * (seeded by `scripts/seed-plans.ts`; see `Plan` schema), so a limit can be
 * tuned or a plan added without a deploy. What stays in code is the SHAPE
 * (`PlanLimits`), the fallback for an unseeded database, and the week math —
 * the parts enforcement is written against.
 *
 * Which plan a USER is on is `User.plan` (a name string); what that plan
 * means is the collection row. `PlansService` joins the two, resolving a
 * row's `null` limits (the `no-limit-plan` convention) to Infinity so the
 * enforcement sites keep their plain `count >= limit` shape.
 */

export interface PlanLimits {
  /** Most groups one user may OWN. Membership of other groups is unlimited. */
  readonly maxGroupsOwned: number;
  /**
   * Most events one user may CREATE with dates inside one calendar week
   * (UTC, Monday-start). Counted against the week of the EVENT's date, not
   * the moment of creation — the limit is on how much gets scheduled, and
   * counting creation time would let one busy evening book a month solid.
   */
  readonly maxEventsPerWeek: number;
  /**
   * Most photos in one GROUP's gallery — the group's own photos plus its
   * events' photos, i.e. exactly what `GET /groups/:id/photos` shows. Full
   * means full: freeing a slot takes deleting an existing image.
   */
  readonly maxGalleryPhotosPerGroup: number;
}

/** The plan every user starts on, and the `User.plan` schema default. */
export const DEFAULT_PLAN = 'default';

/**
 * The default plan's limits, duplicated from the seed as the LAST-RESORT
 * fallback: an unseeded or unreachable `plans` collection degrades to the
 * tightest limits rather than crashing creation or, worse, skipping
 * enforcement. `scripts/seed-plans.ts` is the authority; keep the two equal.
 */
export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  maxGroupsOwned: 2,
  maxEventsPerWeek: 3,
  maxGalleryPhotosPerGroup: 50,
};

/**
 * One stored limit → one enforceable number.
 *
 * `null` is the explicit "unlimited" convention (how `no-limit-plan` lifts
 * every cap) and becomes Infinity, which no count reaches. A MISSING field is
 * not the same thing: a half-seeded row falls back to the default plan's
 * value, so absence degrades tight, never open.
 */
export function resolveLimit(
  stored: number | null | undefined,
  fallback: number,
): number {
  if (stored === null) return Number.POSITIVE_INFINITY;
  return typeof stored === 'number' ? stored : fallback;
}

/**
 * The UTC calendar week (Monday 00:00 inclusive → next Monday exclusive)
 * containing `date`. The window `maxEventsPerWeek` is counted over.
 *
 * UTC because event dates are stored as instants and the server must count
 * consistently regardless of who asks; Monday-start to match how a playing
 * week is talked about (fixtures run Mon–Sun, not Sun–Sat).
 */
export function weekOf(date: Date): { start: Date; end: Date } {
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const start = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - sinceMonday,
    ),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}
