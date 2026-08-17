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

  describe('listMine — events the caller joined', () => {
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
      await service.listMine(USER);

      expect(playerModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'joined' }),
      );
    });

    it('queries only the events on the roster', async () => {
      await service.listMine(USER);

      expect(eventModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ _id: { $in: ['e1', 'e2'] } }),
      );
    });

    it('returns [] without querying events when nothing was joined', async () => {
      playerModel.find.mockReturnValue(joinedRows([]));

      await expect(service.listMine(USER)).resolves.toEqual([]);
      // No $in against an empty array.
      expect(eventModel.find).not.toHaveBeenCalled();
    });

    it('hides expired and done events by default', async () => {
      await service.listMine(USER);

      const filter = eventModel.find.mock.calls[0][0];
      expect(filter.date.$gte).toBeInstanceOf(Date);
      expect(filter.status).toEqual({ $ne: 'done' });
    });

    it('includeExpired returns everything', async () => {
      await service.listMine(USER, undefined, true);

      const filter = eventModel.find.mock.calls[0][0];
      expect(filter.date).toBeUndefined();
      expect(filter.status).toBeUndefined();
    });

    it('an explicit status overrides the done exclusion', async () => {
      await service.listMine(USER, 'done');

      const filter = eventModel.find.mock.calls[0][0];
      expect(filter.status).toBe('done');
    });

    it('rejects an unknown status', async () => {
      await expect(service.listMine(USER, 'bogus')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('sorts soonest first, not newest first', async () => {
      // Opposite of the profile matchHistory, which is a history view.
      const chain = findChain([]);
      eventModel.find.mockReturnValue(chain);

      await service.listMine(USER);

      expect(chain.sort).toHaveBeenCalledWith({ date: 1 });
    });

    it('marks every row joinedByMe and isFull', async () => {
      eventModel.find.mockReturnValue(
        findChain([{ _id: 'e1', joinedCount: 2, maxPlayers: 2 }]),
      );

      const res: any = await service.listMine(USER);

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
