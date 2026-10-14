// src/events/events.service.anonymous.spec.ts
//
// Anonymous players: an accountless walk-in joins a PUBLIC event under just
// a name. Guests (sponsored, approval-gated) are unchanged.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { EventsService } from './events.service';
import { eventsProviders } from './events.test-providers';

const EVENT_ID = '507f1f77bcf86cd799439051';
const CREATOR = '507f191e810c19729de86021';
const STRANGER = '507f191e810c19729de86022';
const ROW_ID = '507f1f77bcf86cd799439052';

describe('EventsService — anonymous players', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};

  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // A public event, open and with room.
    eventModel.findById = jest.fn().mockImplementation(() => {
      const doc: any = {
        _id: new Types.ObjectId(EVENT_ID),
        isPublic: true,
        type: 'normal',
        status: 'join',
        createdBy: new Types.ObjectId(CREATOR),
        groupId: null,
      };
      doc.select = () => ({ lean: () => Promise.resolve(doc) });
      doc.lean = () => Promise.resolve(doc);
      return Object.assign(Promise.resolve(doc), doc);
    });
    eventModel.findOneAndUpdate = jest
      .fn()
      .mockResolvedValue({ joinedCount: 5, maxPlayers: 12 });
    playerModel.create = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(ROW_ID),
      guestName: 'Aung Aung',
    });
    playerModel.findOne = jest.fn().mockResolvedValue(null);
    memberModel.findOne = jest.fn().mockResolvedValue(null);

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({ eventModel, playerModel, memberModel }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  const join = (name = 'Aung Aung') =>
    service.joinAnonymous(EVENT_ID, { name });

  describe('joinAnonymous', () => {
    it('refuses a PRIVATE event — public is the invitation', async () => {
      eventModel.findById.mockImplementation(() => {
        const doc: any = { _id: EVENT_ID, isPublic: false, status: 'join' };
        doc.select = () => ({ lean: () => Promise.resolve(doc) });
        return doc;
      });
      await expect(join()).rejects.toThrow(/Only public events/);
      expect(playerModel.create).not.toHaveBeenCalled();
    });

    it('uses the same atomic capacity guard as a normal join', async () => {
      await join();

      const [guard, update] = eventModel.findOneAndUpdate.mock.calls[0];
      expect(guard.status).toBe('join');
      expect(guard.$expr).toEqual({ $lt: ['$joinedCount', '$maxPlayers'] });
      expect(update).toEqual({ $inc: { joinedCount: 1 } });
    });

    it('creates an approved, sponsorless row under the given name', async () => {
      const res = await join('  Aung Aung  ');

      const [row] = playerModel.create.mock.calls[0];
      expect(row.type).toBe('anonymous');
      expect(row.status).toBe('joined');
      expect(row.guestName).toBe('Aung Aung'); // trimmed
      expect(row).not.toHaveProperty('userId');
      expect(row).not.toHaveProperty('addedByUserId');
      expect(row).not.toHaveProperty('approval'); // schema default: approved

      // The row id is the only handle an accountless player has.
      expect(res.playerId).toBe(ROW_ID);
    });

    it('reports "not open" vs "full" when the guard misses', async () => {
      eventModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(join()).rejects.toThrow(/full/); // status join, no room

      eventModel.findById.mockImplementation(() => {
        const doc: any = {
          _id: EVENT_ID,
          isPublic: true,
          status: 'preparation',
        };
        doc.select = () => ({ lean: () => Promise.resolve(doc) });
        doc.lean = () => Promise.resolve(doc);
        return Object.assign(Promise.resolve(doc), doc);
      });
      await expect(join()).rejects.toThrow(/not open for joining/);
    });

    it('404s a malformed or unknown event id', async () => {
      await expect(
        service.joinAnonymous('nope', { name: 'A' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeAnonymous — the only exit an accountless row has', () => {
    const anonRow = () => ({
      status: 'joined',
      type: 'anonymous',
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('organizer only', async () => {
      await expect(
        service.removeAnonymous(EVENT_ID, STRANGER, ROW_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cancels the row and frees the slot', async () => {
      const row = anonRow();
      playerModel.findOne.mockResolvedValue(row);

      await service.removeAnonymous(EVENT_ID, CREATOR, ROW_ID);

      // The lookup is pinned to anonymous rows — a guest or registered row
      // must not be removable through this door.
      expect(playerModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'anonymous', status: 'joined' }),
      );
      expect(row.status).toBe('cancelled');
      const [guard, update] = eventModel.findOneAndUpdate.mock.calls[0];
      expect(guard.joinedCount).toEqual({ $gt: 0 });
      expect(update).toEqual({ $inc: { joinedCount: -1 } });
    });

    it('404s a row that is not an anonymous player here', async () => {
      playerModel.findOne.mockResolvedValue(null);
      await expect(
        service.removeAnonymous(EVENT_ID, CREATOR, ROW_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s a malformed player id', async () => {
      await expect(
        service.removeAnonymous(EVENT_ID, CREATOR, 'nope'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
