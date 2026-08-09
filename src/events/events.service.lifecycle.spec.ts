import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { Event } from './schemas/event.schema';
import { EventPlayer } from './schemas/event-player.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { Group } from '../groups/schemas/group.schema';
import { LocationsService } from '../locations/locations.service';
import { EVENT_STATUSES } from './events.lifecycle';

const EVENT_ID = '507f1f77bcf86cd799439011';
const CREATOR = '507f191e810c19729de860ea';
const STRANGER = '507f191e810c19729de860eb';
const GROUP_ID = '507f191e810c19729de860ec';

/** A saveable event doc double: records what was persisted. */
const eventDoc = (over: Record<string, unknown> = {}) => {
  const doc: any = {
    _id: EVENT_ID,
    createdBy: new Types.ObjectId(CREATOR),
    groupId: null,
    status: 'join',
    joinedCount: 0,
    maxPlayers: 12,
    date: new Date('2026-09-01T10:00:00.000Z'),
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
    toJSON: jest.fn().mockImplementation(function (this: any) {
      const { save, toJSON, ...rest } = this;
      return rest;
    }),
    ...over,
  };
  return doc;
};

describe('EventsService — lifecycle', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};
  const groupModel: any = {};
  const locations: any = { assertOwnedBy: jest.fn(), assertCanEdit: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.findById = jest.fn();
    eventModel.findOneAndUpdate = jest.fn().mockResolvedValue(null);
    eventModel.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    playerModel.findOne = jest.fn();
    playerModel.create = jest.fn();
    playerModel.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });
    memberModel.findOne = jest.fn().mockResolvedValue(null);

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: LocationsService, useValue: locations },
      ],
    }).compile();
    service = m.get(EventsService);
  });

  describe('assertOrganizer', () => {
    it('allows the creator of a personal event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(
        service.assertOrganizer(EVENT_ID, CREATOR),
      ).resolves.toBeDefined();
    });

    it('rejects a stranger on a personal event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(
        service.assertOrganizer(EVENT_ID, STRANGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an approved group owner/admin who did not create it', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ groupId: new Types.ObjectId(GROUP_ID) }),
      );
      memberModel.findOne.mockResolvedValue({ role: 'admin' });

      await expect(
        service.assertOrganizer(EVENT_ID, STRANGER),
      ).resolves.toBeDefined();
      // must require approved owner/admin, not merely membership
      const q = memberModel.findOne.mock.calls[0][0];
      expect(q.status).toBe('approved');
      expect(q.role).toEqual({ $in: ['owner', 'admin'] });
    });

    it('still allows the creator of a group event who lost their role', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ groupId: new Types.ObjectId(GROUP_ID) }),
      );
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.assertOrganizer(EVENT_ID, CREATOR),
      ).resolves.toBeDefined();
    });

    it('rejects a non-member stranger on a group event', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ groupId: new Types.ObjectId(GROUP_ID) }),
      );
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.assertOrganizer(EVENT_ID, STRANGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s an unknown event', async () => {
      eventModel.findById.mockResolvedValue(null);
      await expect(
        service.assertOrganizer(EVENT_ID, CREATOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setStatus', () => {
    it('advances through a legal transition and persists', async () => {
      const doc = eventDoc({ status: 'join' });
      eventModel.findById.mockResolvedValue(doc);

      await service.setStatus(EVENT_ID, CREATOR, 'before_match');

      expect(doc.status).toBe('before_match');
      expect(doc.save).toHaveBeenCalled();
    });

    it('409s an illegal transition and leaves the event untouched', async () => {
      const doc = eventDoc({ status: 'join' });
      eventModel.findById.mockResolvedValue(doc);

      await expect(
        service.setStatus(EVENT_ID, CREATOR, 'playing'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(doc.status).toBe('join');
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('409s any move out of done', async () => {
      for (const to of EVENT_STATUSES) {
        const doc = eventDoc({ status: 'done' });
        eventModel.findById.mockResolvedValue(doc);
        await expect(
          service.setStatus(EVENT_ID, CREATOR, to),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(doc.save).not.toHaveBeenCalled();
      }
    });

    it('400s an unknown status value', async () => {
      const doc = eventDoc({ status: 'join' });
      eventModel.findById.mockResolvedValue(doc);
      await expect(
        service.setStatus(EVENT_ID, CREATOR, 'open'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('403s a non-organizer before consulting the table', async () => {
      const doc = eventDoc({ status: 'join' });
      eventModel.findById.mockResolvedValue(doc);
      await expect(
        service.setStatus(EVENT_ID, STRANGER, 'before_match'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('walks the whole happy path end to end', async () => {
      const path = [
        ['join', 'before_match'],
        ['before_match', 'preparation'],
        ['preparation', 'playing'],
        ['playing', 'after_match'],
        ['after_match', 'done'],
      ] as const;

      for (const [from, to] of path) {
        const doc = eventDoc({ status: from });
        eventModel.findById.mockResolvedValue(doc);
        await service.setStatus(EVENT_ID, CREATOR, to);
        expect(doc.status).toBe(to);
      }
    });
  });

  describe('join / leave gating', () => {
    it('joins only while the atomic guard matches status join', async () => {
      playerModel.findOne.mockResolvedValue(null);
      eventModel.findOneAndUpdate.mockResolvedValue({
        joinedCount: 1,
        maxPlayers: 12,
      });
      playerModel.create.mockResolvedValue({});

      await service.join(EVENT_ID, STRANGER);

      const filter = eventModel.findOneAndUpdate.mock.calls[0][0];
      expect(filter.status).toBe('join');
      expect(filter.$expr).toEqual({ $lt: ['$joinedCount', '$maxPlayers'] });
    });

    it('never flips status to full at capacity', async () => {
      playerModel.findOne.mockResolvedValue(null);
      eventModel.findOneAndUpdate.mockResolvedValue({
        joinedCount: 12,
        maxPlayers: 12,
      });
      playerModel.create.mockResolvedValue({});
      eventModel.findByIdAndUpdate = jest.fn();

      await service.join(EVENT_ID, STRANGER);

      // capacity is derived now — no second write setting status
      expect(eventModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('reports "not open" vs "full" correctly when the guard misses', async () => {
      playerModel.findOne.mockResolvedValue(null);
      eventModel.findOneAndUpdate.mockResolvedValue(null);

      eventModel.findById.mockReturnValue({
        lean: () => Promise.resolve({ status: 'preparation' }),
      });
      await expect(service.join(EVENT_ID, STRANGER)).rejects.toThrow(
        /not open for joining/,
      );

      eventModel.findById.mockReturnValue({
        lean: () => Promise.resolve({ status: 'join' }),
      });
      await expect(service.join(EVENT_ID, STRANGER)).rejects.toThrow(/full/);
    });

    it.each(EVENT_STATUSES.filter((s) => s !== 'join'))(
      'refuses to leave in %s',
      async (status) => {
        eventModel.findById.mockReturnValue({
          lean: () => Promise.resolve({ status }),
        });

        await expect(service.leave(EVENT_ID, STRANGER)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        // the player row must not be touched when the gate rejects
        expect(playerModel.findOne).not.toHaveBeenCalled();
      },
    );

    it('leaves in join and decrements without going negative', async () => {
      eventModel.findById.mockReturnValue({
        lean: () => Promise.resolve({ status: 'join' }),
      });
      playerModel.findOne.mockResolvedValue({
        status: 'joined',
        save: jest.fn().mockResolvedValue({}),
      });

      await service.leave(EVENT_ID, STRANGER);

      const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
      expect(filter.status).toBe('join');
      expect(filter.joinedCount).toEqual({ $gt: 0 });
      expect(update).toEqual({ $inc: { joinedCount: -1 } });
    });
  });

  describe('listByGroup', () => {
    const lean = (rows: any[]) => ({
      sort: () => ({ lean: () => Promise.resolve(rows) }),
    });

    beforeEach(() => {
      groupModel.findById = jest.fn().mockReturnValue({
        select: () => ({ lean: () => Promise.resolve({ _id: GROUP_ID }) }),
      });
      eventModel.find = jest.fn().mockReturnValue(lean([]));
    });

    it('shows an approved member every event, public or private', async () => {
      memberModel.findOne.mockResolvedValue({ role: 'member' });

      await service.listByGroup(GROUP_ID, STRANGER);

      const filter = eventModel.find.mock.calls[0][0];
      expect(filter.groupId.toString()).toBe(GROUP_ID);
      // no isPublic constraint for members
      expect(filter).not.toHaveProperty('isPublic');
    });

    it('restricts a non-member to public events only', async () => {
      memberModel.findOne.mockResolvedValue(null);

      await service.listByGroup(GROUP_ID, STRANGER);

      expect(eventModel.find.mock.calls[0][0].isPublic).toBe(true);
    });

    it('requires the membership to be approved, not merely pending', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await service.listByGroup(GROUP_ID, STRANGER);
      expect(memberModel.findOne.mock.calls[0][0].status).toBe('approved');
    });

    it('optionally narrows to one lifecycle status', async () => {
      memberModel.findOne.mockResolvedValue({ role: 'member' });
      await service.listByGroup(GROUP_ID, STRANGER, 'join');
      expect(eventModel.find.mock.calls[0][0].status).toBe('join');
    });

    it('400s an unknown status rather than returning everything', async () => {
      memberModel.findOne.mockResolvedValue({ role: 'member' });
      await expect(
        service.listByGroup(GROUP_ID, STRANGER, 'open'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(eventModel.find).not.toHaveBeenCalled();
    });

    it('404s an unknown group instead of returning an empty list', async () => {
      groupModel.findById.mockReturnValue({
        select: () => ({ lean: () => Promise.resolve(null) }),
      });
      await expect(
        service.listByGroup(GROUP_ID, STRANGER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s a malformed group id', async () => {
      await expect(
        service.listByGroup('not-an-id', STRANGER),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('attaches derived isFull to each row', async () => {
      memberModel.findOne.mockResolvedValue({ role: 'member' });
      eventModel.find.mockReturnValue(
        lean([
          { _id: 'a', joinedCount: 12, maxPlayers: 12 },
          { _id: 'b', joinedCount: 3, maxPlayers: 12 },
        ]),
      );

      const rows: any[] = await service.listByGroup(GROUP_ID, STRANGER);
      expect(rows[0].isFull).toBe(true);
      expect(rows[1].isFull).toBe(false);
    });

    it('sorts soonest first', async () => {
      memberModel.findOne.mockResolvedValue({ role: 'member' });
      const sort = jest.fn().mockReturnValue({ lean: () => Promise.resolve([]) });
      eventModel.find.mockReturnValue({ sort });
      await service.listByGroup(GROUP_ID, STRANGER);
      expect(sort).toHaveBeenCalledWith({ date: 1 });
    });
  });

  describe('update / remove gating', () => {
    it('rejects editing a done event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'done' }));
      await expect(
        service.update(EVENT_ID, CREATOR, { title: 'new' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects deleting a done event, keeping it as history', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'done' }));
      await expect(
        service.remove(EVENT_ID, CREATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(eventModel.deleteOne).not.toHaveBeenCalled();
    });

    it.each(['join', 'before_match', 'preparation', 'playing', 'after_match'])(
      'allows edit in %s',
      async (status) => {
        const doc = eventDoc({ status });
        eventModel.findById.mockResolvedValue(doc);
        await service.update(EVENT_ID, CREATOR, { title: 'renamed' });
        expect(doc.title).toBe('renamed');
        expect(doc.save).toHaveBeenCalled();
      },
    );

    it('uses assertCanEdit when re-attaching a location', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const loc = '507f1f77bcf86cd799439099';
      await service.update(EVENT_ID, CREATOR, { locationId: loc });
      expect(locations.assertCanEdit).toHaveBeenCalledWith(loc, CREATOR);
      expect(locations.assertOwnedBy).not.toHaveBeenCalled();
    });

    it('does not let a PATCH smuggle in a status change', async () => {
      const doc = eventDoc({ status: 'join' });
      eventModel.findById.mockResolvedValue(doc);
      await service.update(EVENT_ID, CREATOR, {
        status: 'done',
        title: 'ok',
      } as any);
      // status is not an UpdateEventDto field; the lifecycle only moves
      // through setStatus
      expect(doc.status).toBe('join');
    });

    it('removes the event and its player rows', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'join' }));
      await service.remove(EVENT_ID, CREATOR);
      expect(playerModel.deleteMany).toHaveBeenCalled();
      expect(eventModel.deleteOne).toHaveBeenCalled();
    });

    it('403s a stranger deleting an event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'join' }));
      await expect(
        service.remove(EVENT_ID, STRANGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(eventModel.deleteOne).not.toHaveBeenCalled();
    });
  });
});
