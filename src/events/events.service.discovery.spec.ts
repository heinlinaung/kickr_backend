// src/events/events.service.discovery.spec.ts
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { eventsProviders } from './events.test-providers';

const EVENT_ID = '507f1f77bcf86cd799439011';
const USER = '507f191e810c19729de860ea';
const OTHER = '507f191e810c19729de860eb';
const LOC_A = '507f191e810c19729de860c1';
const TEMPLATE_ID = '507f191e810c19729de860d1';

/** eventModel.find(...).sort(...).lean() */
const findChain = (rows: any[]) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
});

describe('EventsService — discovery, likes, templates (spec §4.5)', () => {
  let service: EventsService;
  const eventModel: any = {};
  const likeModel: any = {};
  const templateModel: any = {};
  const locationModel: any = {};
  const locations: any = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.find = jest.fn().mockReturnValue(findChain([]));
    eventModel.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: EVENT_ID }),
    });
    eventModel.updateOne = jest.fn().mockResolvedValue({});
    likeModel.updateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    likeModel.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    likeModel.exists = jest.fn().mockResolvedValue(null);
    templateModel.find = jest.fn().mockReturnValue(findChain([]));
    templateModel.findById = jest.fn();
    templateModel.create = jest.fn().mockResolvedValue({ _id: 't1' });
    templateModel.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    locationModel.aggregate = jest.fn().mockResolvedValue([]);
    locations.assertCanEdit = jest.fn();

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          likeModel,
          templateModel,
          locationModel,
          locations,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  describe('geo discovery — ?near= & radius', () => {
    it('queries locations with $geoNear as the FIRST stage', async () => {
      locationModel.aggregate.mockResolvedValue([
        { _id: new Types.ObjectId(LOC_A) },
      ]);

      await service.list(USER, { near: '16.8409,96.1735' });

      const pipeline = locationModel.aggregate.mock.calls[0][0];
      // $geoNear must lead the pipeline or Mongo rejects it (spec §5.6).
      expect(Object.keys(pipeline[0])).toEqual(['$geoNear']);
    });

    it('swaps lat,lng into GeoJSON [lng, lat] order', async () => {
      await service.list(USER, { near: '16.8409,96.1735' });

      const stage = locationModel.aggregate.mock.calls[0][0][0].$geoNear;
      // The classic geo bug: sending [lat, lng] silently searches elsewhere.
      expect(stage.near.coordinates).toEqual([96.1735, 16.8409]);
    });

    it('applies an explicit radius in metres', async () => {
      await service.list(USER, { near: '1,2', radius: 500 });
      expect(
        locationModel.aggregate.mock.calls[0][0][0].$geoNear.maxDistance,
      ).toBe(500);
    });

    it('falls back to a default radius when none is given', async () => {
      await service.list(USER, { near: '1,2' });
      expect(
        locationModel.aggregate.mock.calls[0][0][0].$geoNear.maxDistance,
      ).toBe(10_000);
    });

    it('filters events to the locations found', async () => {
      const id = new Types.ObjectId(LOC_A);
      locationModel.aggregate.mockResolvedValue([{ _id: id }]);

      await service.list(USER, { near: '1,2' });

      expect(eventModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: { $in: [id] } }),
      );
    });

    it('returns nothing when no location is in range', async () => {
      locationModel.aggregate.mockResolvedValue([]);
      await expect(service.list(USER, { near: '1,2' })).resolves.toEqual([]);
      expect(eventModel.find).not.toHaveBeenCalled();
    });

    it.each(['16.8409', 'not,coords', '1,2,3'])(
      'rejects a malformed near value %p',
      async (near) => {
        await expect(service.list(USER, { near })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

    it('rejects coordinates outside valid ranges', async () => {
      await expect(service.list(USER, { near: '91,0' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.list(USER, { near: '0,181' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ignores an empty near value rather than erroring', async () => {
      // An absent filter is not a malformed one — no geo lookup should run.
      await expect(service.list(USER, { near: '' })).resolves.toEqual([]);
      expect(locationModel.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('search — free text over public events', () => {
    const filter = () => eventModel.find.mock.calls[0][0];

    it('matches title and description case-insensitively', async () => {
      await service.search('friday');

      const or = filter().$or;
      expect(or.map((c: any) => Object.keys(c)[0])).toEqual([
        'title',
        'description',
      ]);
      expect(or[0].title.flags).toContain('i');
      expect(or[0].title.test('FRIDAY night football')).toBe(true);
    });

    it('returns an empty page for an empty query without querying', async () => {
      const empty = { items: [], nextCursor: null, hasMore: false };
      await expect(service.search('')).resolves.toEqual(empty);
      await expect(service.search('  ')).resolves.toEqual(empty);
      expect(eventModel.find).not.toHaveBeenCalled();
    });

    it('only ever returns public events', async () => {
      // A private group event must not surface here, member or not.
      await service.search('friday');
      expect(filter().isPublic).toBe(true);
    });

    it('hides expired and done events by default', async () => {
      await service.search('friday');
      expect(filter().date.$gte).toBeInstanceOf(Date);
      expect(filter().status).toEqual({ $ne: 'done' });
    });

    it('includeExpired returns past and done events', async () => {
      await service.search('friday', true);
      expect(filter().date).toBeUndefined();
      expect(filter().status).toBeUndefined();
    });

    it('treats regex metacharacters as literal text', async () => {
      await service.search('a.c');
      const rx = filter().$or[0].title;
      expect(rx.test('abc')).toBe(false);
      expect(rx.test('a.c')).toBe(true);
    });

    it('sorts soonest first and caps the result set', async () => {
      const c = findChain([]);
      c.limit = jest.fn().mockReturnThis();
      eventModel.find.mockReturnValue(c);

      await service.search('friday');

      // _id breaks the tie: `date` alone is not unique, so a keyset cursor
      // would skip or repeat rows that share a date.
      expect(c.sort).toHaveBeenCalledWith({ date: 1, _id: 1 });
      // limit+1 — the extra row is the lookahead that sets hasMore.
      expect(c.limit).toHaveBeenCalledWith(21);
    });

    it('caps limit at 50 and floors it at 1', async () => {
      const mk = () => {
        const c = findChain([]);
        eventModel.find.mockReturnValue(c);
        return c;
      };
      let c = mk();
      await service.search('x', false, 5000);
      expect(c.limit).toHaveBeenCalledWith(51);

      c = mk();
      await service.search('x', false, 0);
      expect(c.limit).toHaveBeenCalledWith(2);
    });

    it('falls back to the default for a non-numeric limit', async () => {
      // `?limit=abc` arrives as NaN. The clamp cannot catch it — every NaN
      // comparison is false — so it must be rejected explicitly, or Mongoose
      // receives .limit(NaN).
      const c = findChain([]);
      eventModel.find.mockReturnValue(c);

      await service.search('x', false, Number('abc'));
      expect(c.limit).toHaveBeenCalledWith(21);
    });

    describe('cursor pagination', () => {
      const DATE_A = new Date('2026-09-01T10:00:00.000Z');
      const ID_A = '507f1f77bcf86cd799439011';

      /**
       * Builds `n` rows so the lookahead row exists.
       *
       * Real ObjectIds, not `e0`/`e1`: the cursor validates `_id` before it
       * reaches Mongoose, so a fake id would be rejected as a bad cursor.
       */
      const rows = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          _id: new Types.ObjectId(),
          date: DATE_A,
          joinedCount: 0,
          maxPlayers: 10,
          seq: i,
        }));

      it('returns a paged envelope, not a bare array', async () => {
        eventModel.find.mockReturnValue(findChain(rows(3)));

        const res: any = await service.search('friday', false, 2);

        expect(Array.isArray(res)).toBe(false);
        expect(res.items).toHaveLength(2);
        expect(res.hasMore).toBe(true);
        expect(typeof res.nextCursor).toBe('string');
      });

      it('drops the lookahead row from items', async () => {
        // 3 rows fetched for a limit of 2: the third only sets hasMore.
        eventModel.find.mockReturnValue(findChain(rows(3)));

        const res: any = await service.search('friday', false, 2);
        expect(res.items).toHaveLength(2);
      });

      it('reports the end of the result set', async () => {
        // Fewer rows than the lookahead asked for → nothing further.
        eventModel.find.mockReturnValue(findChain(rows(2)));

        const res: any = await service.search('friday', false, 5);
        expect(res.hasMore).toBe(false);
        expect(res.nextCursor).toBeNull();
      });

      it('adds no keyset predicate on the first page', async () => {
        await service.search('friday');
        expect(filter().$and).toBeUndefined();
      });

      it('resumes strictly after the cursor row', async () => {
        const cursor = Buffer.from(
          JSON.stringify({ d: DATE_A.toISOString(), i: ID_A }),
        ).toString('base64url');

        await service.search('friday', false, 20, cursor);

        // Keyset, not skip: later date, OR same date with a greater _id.
        const or = filter().$and[0].$or;
        expect(or[0].date.$gt).toEqual(DATE_A);
        expect(or[1].date).toEqual(DATE_A);
        expect(or[1]._id.$gt.toString()).toBe(ID_A);
      });

      it('round-trips its own cursor', async () => {
        eventModel.find.mockReturnValue(findChain(rows(3)));
        const first: any = await service.search('friday', false, 2);

        jest.clearAllMocks();
        eventModel.find.mockReturnValue(findChain(rows(1)));
        await service.search('friday', false, 2, first.nextCursor);

        // The decoded cursor must produce a usable predicate.
        expect(eventModel.find.mock.calls[0][0].$and).toBeDefined();
      });

      it('rejects a malformed cursor', async () => {
        await expect(
          service.search('friday', false, 20, 'not-a-cursor'),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('attaches the derived isFull to each row', async () => {
      const c = findChain([{ _id: 'e1', joinedCount: 4, maxPlayers: 4 }]);
      c.limit = jest.fn().mockReturnThis();
      eventModel.find.mockReturnValue(c);

      const res: any = await service.search('friday');
      expect(res.items[0].isFull).toBe(true);
    });
  });

  describe('listJoined — events the caller joined', () => {
    const playerModel: any = {};

    /** playerModel.find(...).select(...).lean() -> roster rows */
    const joinedRows = (eventIds: string[]) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest
        .fn()
        .mockResolvedValue(eventIds.map((id) => ({ eventId: id }))),
    });

    beforeEach(async () => {
      playerModel.find = jest.fn().mockReturnValue(joinedRows(['e1', 'e2']));
      const m = await Test.createTestingModule({
        providers: [
          EventsService,
          ...eventsProviders({ eventModel, playerModel, likeModel }),
        ],
      }).compile();
      service = m.get(EventsService);
    });

    it("only counts rows with status 'joined'", async () => {
      // A cancelled row survives for reactivation; counting it would resurrect
      // an event the user left.
      await service.listJoined(USER);

      expect(playerModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'joined' }),
      );
    });

    it('queries only the events on the roster', async () => {
      await service.listJoined(USER);

      expect(eventModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ _id: { $in: ['e1', 'e2'] } }),
      );
    });

    it('returns [] without querying events when nothing was joined', async () => {
      playerModel.find.mockReturnValue(joinedRows([]));

      await expect(service.listJoined(USER)).resolves.toEqual([]);
      // No $in against an empty array.
      expect(eventModel.find).not.toHaveBeenCalled();
    });

    it('hides expired and done events by default', async () => {
      await service.listJoined(USER);

      const filter = eventModel.find.mock.calls[0][0];
      expect(filter.date.$gte).toBeInstanceOf(Date);
      expect(filter.status).toEqual({ $ne: 'done' });
    });

    it('includeExpired drops the DATE filter but still hides done', async () => {
      // This is the ongoing list. `includeExpired` is about dates — a
      // finished event must not reappear just because history was asked for.
      await service.listJoined(USER, undefined, true);

      const filter = eventModel.find.mock.calls[0][0];
      expect(filter.date).toBeUndefined();
      expect(filter.status).toEqual({ $ne: 'done' });
    });

    it('never shows a done event unless it is asked for by name', async () => {
      // The reported bug: a `done` event appeared in the ongoing list.
      for (const includeExpired of [false, true]) {
        jest.clearAllMocks();
        eventModel.find.mockReturnValue(findChain([]));
        playerModel.find = jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ eventId: EVENT_ID }]),
        });

        await service.listJoined(USER, undefined, includeExpired);

        expect(eventModel.find.mock.calls[0][0].status).toEqual({
          $ne: 'done',
        });
      }
    });

    it('an explicit ?status=done is the one way to see finished events', async () => {
      // Deliberate escape hatch for a history screen.
      await service.listJoined(USER, 'done');

      const filter = eventModel.find.mock.calls[0][0];
      expect(filter.status).toBe('done');
    });

    it('rejects an unknown status', async () => {
      await expect(service.listJoined(USER, 'bogus')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('sorts soonest first, not newest first', async () => {
      // Opposite of the profile matchHistory, which is a history view.
      const chain = findChain([]);
      eventModel.find.mockReturnValue(chain);

      await service.listJoined(USER);

      expect(chain.sort).toHaveBeenCalledWith({ date: 1 });
    });

    it('marks every row joinedByMe and isFull', async () => {
      eventModel.find.mockReturnValue(
        findChain([{ _id: 'e1', joinedCount: 2, maxPlayers: 2 }]),
      );

      const res: any = await service.listJoined(USER);

      expect(res[0].joinedByMe).toBe(true);
      expect(res[0].isFull).toBe(true);
    });
  });

  describe('date and status filters', () => {
    it('builds a date range from `from` and `to`', async () => {
      await service.list(USER, { from: '2026-08-01', to: '2026-08-31' });

      const filter = eventModel.find.mock.calls[0][0];
      expect(filter.date.$gte).toEqual(new Date('2026-08-01'));
      expect(filter.date.$lte).toEqual(new Date('2026-08-31'));
    });

    it('narrows to one lifecycle status', async () => {
      await service.list(USER, { status: 'join' });
      expect(eventModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'join' }),
      );
    });

    it('rejects an unknown status', async () => {
      await expect(
        service.list(USER, { status: 'bogus' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('likes', () => {
    it('increments the counter on a first like', async () => {
      await service.like(EVENT_ID, USER);
      expect(eventModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        { $inc: { likeCount: 1 } },
      );
    });

    it('is idempotent — a repeat like does not double count', async () => {
      likeModel.updateOne.mockResolvedValue({ upsertedCount: 0 });
      await service.like(EVENT_ID, USER);
      expect(eventModel.updateOne).not.toHaveBeenCalled();
    });

    it('404s liking an event that does not exist', async () => {
      eventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });
      await expect(service.like(EVENT_ID, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('decrements on unlike, guarded against going negative', async () => {
      await service.unlike(EVENT_ID, USER);

      const [filter, update] = eventModel.updateOne.mock.calls[0];
      expect(update).toEqual({ $inc: { likeCount: -1 } });
      expect(filter.likeCount).toEqual({ $gt: 0 });
    });

    it('is idempotent — unliking twice is a no-op', async () => {
      likeModel.deleteOne.mockResolvedValue({ deletedCount: 0 });
      await service.unlike(EVENT_ID, USER);
      expect(eventModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('templates', () => {
    it('creates a template owned by the caller', async () => {
      await service.createTemplate(USER, { name: 'Tuesday 5s' });

      expect(templateModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Tuesday 5s' }),
      );
      expect(
        templateModel.create.mock.calls[0][0].ownerId.toString(),
      ).toBe(USER);
    });

    it('checks location permission when the template names one', async () => {
      await service.createTemplate(USER, { name: 'x', locationId: LOC_A });
      expect(locations.assertCanEdit).toHaveBeenCalledWith(LOC_A, USER);
    });

    it('deletes the caller’s own template', async () => {
      templateModel.findById.mockResolvedValue({
        ownerId: new Types.ObjectId(USER),
      });
      await expect(service.removeTemplate(TEMPLATE_ID, USER)).resolves.toEqual({
        message: 'Template deleted successfully',
      });
    });

    it('refuses to delete someone else’s template', async () => {
      templateModel.findById.mockResolvedValue({
        ownerId: new Types.ObjectId(OTHER),
      });
      await expect(
        service.removeTemplate(TEMPLATE_ID, USER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(templateModel.deleteOne).not.toHaveBeenCalled();
    });

    it('404s on a missing template', async () => {
      templateModel.findById.mockResolvedValue(null);
      await expect(service.removeTemplate(TEMPLATE_ID, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
