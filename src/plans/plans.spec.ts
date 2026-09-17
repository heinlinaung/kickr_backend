// src/plans/plans.spec.ts
import { DEFAULT_PLAN, PLANS, planLimits, weekOf } from './plans';

describe('plans registry', () => {
  it('the default plan carries the launch limits', () => {
    expect(PLANS.default).toEqual({
      maxGroupsOwned: 2,
      maxEventsPerWeek: 3,
      maxGalleryPhotosPerGroup: 50,
    });
  });

  it('planLimits resolves the named plan', () => {
    expect(planLimits('default')).toBe(PLANS.default);
  });

  it('planLimits degrades unknown or missing plans to the default', () => {
    // A user created before the field, or on a plan later removed, must get
    // the tightest limits — never a crash, and never unlimited.
    for (const bad of [undefined, null, '', 'premium', 7, {}]) {
      expect(planLimits(bad)).toBe(PLANS[DEFAULT_PLAN]);
    }
  });
});

describe('weekOf — the UTC Monday-start week of a date', () => {
  it('brackets a mid-week date', () => {
    // 2026-09-17 is a Thursday.
    const { start, end } = weekOf(new Date('2026-09-17T15:30:00.000Z'));
    expect(start.toISOString()).toBe('2026-09-14T00:00:00.000Z'); // Monday
    expect(end.toISOString()).toBe('2026-09-21T00:00:00.000Z'); // next Monday
  });

  it('a Monday starts its own week', () => {
    const { start } = weekOf(new Date('2026-09-14T00:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('a Sunday belongs to the week begun the previous Monday', () => {
    const { start, end } = weekOf(new Date('2026-09-20T23:59:59.999Z'));
    expect(start.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('crosses month and year boundaries correctly', () => {
    // 2027-01-01 is a Friday; its week starts Monday 2026-12-28.
    const { start, end } = weekOf(new Date('2027-01-01T12:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-12-28T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-04T00:00:00.000Z');
  });
});
