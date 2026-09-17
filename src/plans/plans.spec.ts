// src/plans/plans.spec.ts
import { DEFAULT_PLAN, DEFAULT_PLAN_LIMITS, resolveLimit, weekOf } from './plans';

describe('plan fallbacks', () => {
  it('the in-code fallback carries the default plan launch limits', () => {
    // Must stay equal to the `default` row in scripts/seed-plans.ts — this is
    // what an unseeded database enforces.
    expect(DEFAULT_PLAN).toBe('default');
    expect(DEFAULT_PLAN_LIMITS).toEqual({
      maxGroupsOwned: 2,
      maxEventsPerWeek: 3,
      maxGalleryPhotosPerGroup: 50,
    });
  });
});

describe('resolveLimit — stored value to enforceable number', () => {
  it('passes a number through', () => {
    expect(resolveLimit(2, 99)).toBe(2);
    expect(resolveLimit(0, 99)).toBe(0);
  });

  it('null means UNLIMITED — the no-limit-plan convention', () => {
    expect(resolveLimit(null, 2)).toBe(Number.POSITIVE_INFINITY);
  });

  it('a MISSING field degrades to the fallback, never to unlimited', () => {
    // A half-seeded row must read tight — only an explicit null lifts a cap.
    expect(resolveLimit(undefined, 2)).toBe(2);
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
