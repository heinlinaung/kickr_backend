// src/plans/plans.ts
/**
 * Plans — what a user's subscription tier allows.
 *
 * Pure module: no Mongoose, no Nest, no I/O — same reasoning as
 * `events.lifecycle.ts`. The registry lives in code rather than a collection
 * because a plan's limits are behaviour the codebase must be written against
 * (every limit needs an enforcement site), so a new plan is a code change
 * anyway; a database row could promise limits nothing enforces.
 *
 * Which plan a USER is on is data (`User.plan`); what that plan MEANS is
 * defined here. `PlansService` joins the two.
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

export const PLANS: Readonly<Record<string, PlanLimits>> = {
  default: {
    maxGroupsOwned: 2,
    maxEventsPerWeek: 3,
    maxGalleryPhotosPerGroup: 50,
  },
};

/** The plan every user starts on, and the `User.plan` schema default. */
export const DEFAULT_PLAN = 'default';

/**
 * The limits for a plan name, falling back to the default plan.
 *
 * Total on purpose: an unknown or missing name (a user created before the
 * field existed, or on a plan that was later removed) degrades to the default
 * limits rather than crashing or, worse, skipping enforcement.
 */
export function planLimits(plan?: unknown): PlanLimits {
  return (typeof plan === 'string' && PLANS[plan]) || PLANS[DEFAULT_PLAN];
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
