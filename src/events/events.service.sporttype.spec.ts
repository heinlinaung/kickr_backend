// src/events/events.service.sporttype.spec.ts
/**
 * sportType rules on events:
 *
 *  - values come from the `sporttypes` collection, not a hardcoded enum;
 *  - a GROUP event always carries its group's sportType — inherited on
 *    create, conflicting writes rejected, group changes propagated via
 *    applyGroupSportType;
 *  - `subType` must be a format the resolved sport lists (football:
 *    futsal/stadium).
 */
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EventsService } from './events.service';
import { eventsProviders, sportTypesDouble } from './events.test-providers';

const USER_ID = '507f191e810c19729de860ea';
const GROUP_ID = '665f1a2b3c4d5e6f7a8b9c0d';

/** thin chainable mongoose query stub */
const q = (result: any) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});

describe('EventsService — sportType from the sporttypes collection', () => {
  let service: EventsService;
  const eventModel: any = {};
  const memberModel: any = {};
  const groupModel: any = {};
  const sportTypes = sportTypesDouble();

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.create = jest.fn().mockResolvedValue({ _id: 'e1' });
    eventModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    // create() meters the creator's events-per-week plan cap.
    eventModel.countDocuments = jest.fn().mockResolvedValue(0);
    // The caller is a group owner, so the create permission gate passes.
    memberModel.findOne = jest.fn().mockResolvedValue({ role: 'owner' });
    groupModel.findById = jest
      .fn()
      .mockReturnValue(q({ sportType: 'football' }));

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({ eventModel, memberModel, groupModel, sportTypes }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  const baseDto = {
    title: 'Sunday game',
    date: '2026-08-01T10:00:00.000Z',
  } as any;

  describe('create — standalone event', () => {
    it('rejects a sportType the collection does not list', async () => {
      await expect(
        service.create(USER_ID, { ...baseDto, sportType: 'cricket' }),
      ).rejects.toThrow(/Unknown sportType 'cricket'/);
      expect(eventModel.create).not.toHaveBeenCalled();
    });

    it('accepts any seeded sport — no more hardcoded football/futsal pair', async () => {
      await expect(
        service.create(USER_ID, { ...baseDto, sportType: 'badminton' }),
      ).resolves.toBeDefined();
    });
  });

  describe('create — group event inherits the group sportType', () => {
    it('copies the group sportType when the caller omits it', async () => {
      groupModel.findById.mockReturnValue(q({ sportType: 'padel' }));

      await service.create(USER_ID, { ...baseDto, groupId: GROUP_ID });

      expect(eventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ sportType: 'padel' }),
      );
    });

    it("rejects a sportType that conflicts with the group's", async () => {
      await expect(
        service.create(USER_ID, {
          ...baseDto,
          groupId: GROUP_ID,
          sportType: 'padel',
        }),
      ).rejects.toThrow(/always its group's \('football'\)/);
      expect(eventModel.create).not.toHaveBeenCalled();
    });

    it('accepts re-sending the matching value — echoing the form back is fine', async () => {
      await expect(
        service.create(USER_ID, {
          ...baseDto,
          groupId: GROUP_ID,
          sportType: 'football',
        }),
      ).resolves.toBeDefined();
    });

    it('a football group event may pick a format', async () => {
      await service.create(USER_ID, {
        ...baseDto,
        groupId: GROUP_ID,
        subType: 'futsal',
      });

      expect(eventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ sportType: 'football', subType: 'futsal' }),
      );
    });

    it('rejects a format the sport does not list', async () => {
      await expect(
        service.create(USER_ID, {
          ...baseDto,
          groupId: GROUP_ID,
          subType: 'beach',
        }),
      ).rejects.toThrow(/Unknown subType 'beach'/);
    });

    it('a group with no sportType leaves the event value free', async () => {
      // Groups created before the field (or that never set it) cannot impose
      // a sport, so the event's own choice stands — still collection-checked.
      groupModel.findById.mockReturnValue(q({}));

      await service.create(USER_ID, {
        ...baseDto,
        groupId: GROUP_ID,
        sportType: 'badminton',
      });

      expect(eventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ sportType: 'badminton' }),
      );
    });

    it('404s when the group does not exist', async () => {
      groupModel.findById.mockReturnValue(q(null));

      await expect(
        service.create(USER_ID, { ...baseDto, groupId: GROUP_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    /** A hydrated-event double that update() can mutate and save. */
    const eventDoc = (over: Record<string, unknown> = {}) => ({
      _id: 'e1',
      createdBy: new Types.ObjectId(USER_ID),
      groupId: null,
      status: 'join',
      sportType: 'football',
      subType: null,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({}),
      ...over,
    });

    it("rejects changing a grouped event's sportType away from the group's", async () => {
      eventModel.findById = jest
        .fn()
        .mockResolvedValue(eventDoc({ groupId: new Types.ObjectId(GROUP_ID) }));

      await expect(
        service.update('e1', USER_ID, { sportType: 'padel' }),
      ).rejects.toThrow(/change the group's sportType instead/);
    });

    it('accepts re-sending the group value on a grouped event', async () => {
      const doc = eventDoc({ groupId: new Types.ObjectId(GROUP_ID) });
      eventModel.findById = jest.fn().mockResolvedValue(doc);

      await service.update('e1', USER_ID, { sportType: 'football' });

      expect(doc.save).toHaveBeenCalled();
    });

    it('a standalone event switches sport by clearing subType in the same patch', async () => {
      const doc = eventDoc({ subType: 'stadium' });
      eventModel.findById = jest.fn().mockResolvedValue(doc);

      // Without the clear, the stale format is rejected...
      await expect(
        service.update('e1', USER_ID, { sportType: 'padel' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // ...with it, the switch lands and the format is gone.
      await service.update('e1', USER_ID, {
        sportType: 'padel',
        subType: null as any,
      });
      expect(doc.sportType).toBe('padel');
      expect(doc.subType).toBeNull();
    });

    it('applies a subType change — it used to be validated but silently dropped', async () => {
      const doc = eventDoc();
      eventModel.findById = jest.fn().mockResolvedValue(doc);

      await service.update('e1', USER_ID, { subType: 'futsal' });

      expect(doc.subType).toBe('futsal');
      expect(doc.save).toHaveBeenCalled();
    });
  });

  describe('setStatus — the lifecycle is sport-aware', () => {
    const eventDoc = (over: Record<string, unknown> = {}) => ({
      _id: 'e1',
      title: 'Sunday game',
      createdBy: new Types.ObjectId(USER_ID),
      groupId: null,
      status: 'join',
      sportType: 'badminton',
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({}),
      ...over,
    });

    it('a non-football event closes registration straight into ready_to_play', async () => {
      const doc = eventDoc();
      eventModel.findById = jest.fn().mockResolvedValue(doc);

      await service.setStatus('e1', USER_ID, 'ready_to_play');

      expect(doc.status).toBe('ready_to_play');
      expect(doc.save).toHaveBeenCalled();
    });

    it('a non-football event cannot enter preparation', async () => {
      // 'preparation' IS a status, just not a reachable one for this sport —
      // so it 409s at the transition check, naming the sport.
      eventModel.findById = jest.fn().mockResolvedValue(eventDoc());

      await expect(
        service.setStatus('e1', USER_ID, 'preparation'),
      ).rejects.toThrow(/Cannot move a badminton event from 'join'/);
    });

    it('a football event keeps the six-state path', async () => {
      const doc = eventDoc({ sportType: 'football' });
      eventModel.findById = jest.fn().mockResolvedValue(doc);

      await expect(
        service.setStatus('e1', USER_ID, 'ready_to_play'),
      ).rejects.toThrow(/Cannot move a football event from 'join'/);

      await service.setStatus('e1', USER_ID, 'preparation');
      expect(doc.status).toBe('preparation');
    });
  });

  describe('applyGroupSportType — group change propagates to its events', () => {
    it('rewrites every event and clears formats the new sport does not list', async () => {
      await service.applyGroupSportType(GROUP_ID, 'padel');

      const groupObjectId = new Types.ObjectId(GROUP_ID);
      expect(eventModel.updateMany).toHaveBeenNthCalledWith(
        1,
        { groupId: groupObjectId },
        { $set: { sportType: 'padel' } },
      );
      // padel lists no formats, so any non-null subType is meaningless now.
      expect(eventModel.updateMany).toHaveBeenNthCalledWith(
        2,
        { groupId: groupObjectId, subType: { $nin: [null] } },
        { $set: { subType: null } },
      );
    });

    it('spares formats the new sport DOES list', async () => {
      await service.applyGroupSportType(GROUP_ID, 'football');

      expect(eventModel.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          subType: { $nin: ['futsal', 'stadium', null] },
        }),
        { $set: { subType: null } },
      );
    });
  });
});
