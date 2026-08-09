import mongoose from 'mongoose';
import { EventSchema } from './event.schema';
import { EventMatchSchema } from './event-match.schema';
import { EVENT_STATUSES } from '../events.lifecycle';

describe('Event schema (location ref migration)', () => {
  it('replaces the flat location trio with a locationId ref', () => {
    const paths = Object.keys(EventSchema.paths);
    expect(paths).toContain('locationId');
    expect(paths).not.toContain('locationName');
    expect(paths).not.toContain('latitude');
    expect(paths).not.toContain('longitude');
  });

  it('locationId refs Location and defaults to null', () => {
    const path: any = EventSchema.path('locationId');
    expect(path.options.ref).toBe('Location');
    expect(path.options.default).toBeNull();
  });
});

describe('Event schema (lifecycle status)', () => {
  it('accepts the six lifecycle states and defaults to join', () => {
    const path: any = EventSchema.path('status');
    expect(path.options.enum).toEqual([...EVENT_STATUSES]);
    expect(path.options.default).toBe('join');
  });

  it('no longer accepts the legacy open/full values', () => {
    const path: any = EventSchema.path('status');
    expect(path.options.enum).not.toContain('open');
    expect(path.options.enum).not.toContain('full');
    // 'done' survives the migration unchanged
    expect(path.options.enum).toContain('done');
  });

  it('indexes status with date for lifecycle-filtered listing', () => {
    const declared = EventSchema.indexes().map(([fields]) => fields);
    expect(declared).toContainEqual({ status: 1, date: 1 });
  });
});

describe('Event schema (step 1 fields for later steps)', () => {
  it('declares the after-match fields', () => {
    const paths = Object.keys(EventSchema.paths);
    for (const p of [
      'startTime',
      'endTime',
      'teamCount',
      'coverImage',
      'coverImageFileId',
      'photos',
      'result',
      'templateId',
      'likeCount',
    ]) {
      expect(paths).toContain(p);
    }
  });

  it('no longer embeds fixtures — they are their own collection', () => {
    // Fixtures moved to EventMatch so each has a stable _id that ratings
    // (spec §8) can reference. Leaving the array behind would give two
    // sources of truth for the same data.
    expect(Object.keys(EventSchema.paths)).not.toContain('matches');
  });

  it('ships them empty — presence is not behaviour', () => {
    expect((EventSchema.path('photos') as any).options.default).toEqual([]);
    expect((EventSchema.path('result') as any).options.default).toBeNull();
    expect((EventSchema.path('startTime') as any).options.default).toBeNull();
    expect((EventSchema.path('likeCount') as any).options.default).toBe(0);
  });

  it('bounds teamCount to 2..6 with a default of 4', () => {
    const path: any = EventSchema.path('teamCount');
    expect(path.options.default).toBe(4);
    expect(path.options.min).toBe(2);
    expect(path.options.max).toBe(6);
  });
});

describe('EventMatch schema (standalone fixtures)', () => {
  it('defaults scores to null, not zero', () => {
    // 0-0 is a real scoreline; unplayed must be distinguishable from a draw
    // or standings would count every unplayed fixture as a point each.
    expect((EventMatchSchema.path('scoreA') as any).options.default).toBeNull();
    expect((EventMatchSchema.path('scoreB') as any).options.default).toBeNull();
    expect(
      (EventMatchSchema.path('playedAt') as any).options.default,
    ).toBeNull();
  });

  it('gives every fixture its own _id for ratings to reference', () => {
    // The whole point of the extraction — an embedded subdoc had _id: false.
    expect(EventMatchSchema.options._id).not.toBe(false);
    expect(Object.keys(EventMatchSchema.paths)).toContain('_id');
  });

  it('ties each fixture to its event and requires the pairing', () => {
    for (const p of ['eventId', 'matchNumber', 'teamA', 'teamB']) {
      expect((EventMatchSchema.path(p) as any).options.required).toBe(true);
    }
  });

  it('enforces one fixture per matchNumber per event', () => {
    // Without this, a re-run of the migration could double-insert a fixture
    // list and silently double every team's played count.
    const indexes = EventMatchSchema.indexes();
    const unique = indexes.find(
      ([fields, opts]: any) =>
        fields.eventId === 1 && fields.matchNumber === 1 && opts?.unique,
    );
    expect(unique).toBeDefined();
  });
});

describe('Event schema (derived capacity)', () => {
  const build = (joinedCount: number, maxPlayers: number) => {
    const Model = mongoose.model(
      `EvtCap${joinedCount}_${maxPlayers}`,
      EventSchema,
    );
    return new Model({
      title: 't',
      date: new Date(),
      createdBy: new mongoose.Types.ObjectId(),
      joinedCount,
      maxPlayers,
    });
  };

  it('exposes isFull as a virtual rather than a stored status', () => {
    expect(Object.keys(EventSchema.paths)).not.toContain('isFull');
    expect(EventSchema.virtuals).toHaveProperty('isFull');
  });

  it('is full at and above capacity, not below', () => {
    expect(build(11, 12).get('isFull')).toBe(false);
    expect(build(12, 12).get('isFull')).toBe(true);
    // over-capacity rows (possible from legacy data) still read as full
    expect(build(13, 12).get('isFull')).toBe(true);
  });

  it('serialises isFull to JSON', () => {
    expect((build(12, 12).toJSON() as any).isFull).toBe(true);
  });
});
