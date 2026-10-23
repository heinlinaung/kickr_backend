// src/awards/awards.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AwardsService } from './awards.service';
import { Award } from './schemas/award.schema';
import { AwardMemory } from './schemas/award-memory.schema';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { User } from '../users/schemas/user.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { decodeCursor } from '../common/pagination/cursor';

const EVENT_ID = '507f1f77bcf86cd799439011';
const ORGANIZER = '507f191e810c19729de860ea';
const PLAYER = '507f191e810c19729de860e1';
const OTHER = '507f191e810c19729de860e2';
const GROUP_ID = '507f1f77bcf86cd799439099';
const CHALLENGE_ID = '507f1f77bcf86cd799439097';
const AWARD_ID = '507f1f77bcf86cd799439055';
const MEMORY_ID = '507f1f77bcf86cd799439066';

const oid = (id: string) => new Types.ObjectId(id);
const event = { _id: oid(EVENT_ID), title: 'Sunday Football' };

/** Resolves `.code` off an awards error, or 'resolved'. */
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (err: any) => err.getResponse?.().code ?? err,
  );

const chain = (result: any) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});

const duplicateKey = Object.assign(new Error('E11000'), { code: 11000 });

describe('AwardsService', () => {
  let service: AwardsService;
  const awardModel: any = {};
  const memoryModel: any = {};
  const groupModel: any = {};
  const memberModel: any = {};
  const userModel: any = {};
  const playerModel: any = {};
  const notifications = { notifyUsers: jest.fn() };

  const awardDoc = (over: Record<string, any> = {}) => ({
    _id: oid(AWARD_ID),
    type: 'MVP',
    recipientKind: 'USER',
    recipientId: oid(PLAYER),
    eventId: oid(EVENT_ID),
    title: 'MVP – Sunday Football',
    eventTitle: 'Sunday Football',
    note: null,
    awardedBy: oid(ORGANIZER),
    awardedAt: new Date('2026-10-18T12:00:00Z'),
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    notifications.notifyUsers.mockResolvedValue({ notified: 1, pushed: 0 });
    awardModel.findOne = jest.fn().mockResolvedValue(null);
    awardModel.create = jest.fn(async (data: any) => awardDoc(data));
    awardModel.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    awardModel.exists = jest.fn().mockResolvedValue(null);
    awardModel.find = jest.fn().mockReturnValue(chain([]));
    memoryModel.find = jest.fn().mockReturnValue(chain([]));
    memoryModel.create = jest.fn(async (data: any) => ({
      _id: oid(MEMORY_ID),
      ...data,
    }));
    memoryModel.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    groupModel.findById = jest.fn().mockReturnValue(chain({ name: 'A FC' }));
    groupModel.find = jest.fn().mockReturnValue(chain([]));
    memberModel.find = jest.fn().mockReturnValue(chain([]));
    memberModel.exists = jest.fn().mockResolvedValue({ _id: 'm' });
    userModel.findById = jest.fn().mockReturnValue(chain({ privacy: {} }));
    playerModel.find = jest.fn().mockReturnValue(chain([]));

    const m = await Test.createTestingModule({
      providers: [
        AwardsService,
        { provide: getModelToken(Award.name), useValue: awardModel },
        { provide: getModelToken(AwardMemory.name), useValue: memoryModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = m.get(AwardsService);
  });

  describe('giveMvp', () => {
    it('creates the award in the API shape and notifies the player', async () => {
      const view = await service.giveMvp({
        event,
        userId: PLAYER,
        awardedBy: ORGANIZER,
        note: '2 goals, 1 assist',
      });

      expect(view).toMatchObject({
        type: 'MVP',
        recipient: { kind: 'USER', id: PLAYER },
        eventId: EVENT_ID,
        title: 'MVP – Sunday Football',
        note: '2 goals, 1 assist',
        awardedBy: ORGANIZER,
      });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        [PLAYER],
        expect.objectContaining({ type: 'event', refId: EVENT_ID }),
      );
    });

    it('same player again only updates the note — no second notification', async () => {
      const existing = awardDoc();
      awardModel.findOne.mockResolvedValue(existing);

      await service.giveMvp({
        event,
        userId: PLAYER,
        awardedBy: ORGANIZER,
        note: 'hat-trick',
      });

      expect(existing.note).toBe('hat-trick');
      expect(existing.save).toHaveBeenCalled();
      expect(awardModel.create).not.toHaveBeenCalled();
      expect(notifications.notifyUsers).not.toHaveBeenCalled();
    });

    it('MVP_ALREADY_AWARDED for a different player', async () => {
      awardModel.findOne.mockResolvedValue(awardDoc());
      expect(
        await code(
          service.giveMvp({ event, userId: OTHER, awardedBy: ORGANIZER }),
        ),
      ).toBe('MVP_ALREADY_AWARDED');
    });

    it('replace swaps the holder (legacy POST /events/:id/mvp)', async () => {
      awardModel.findOne.mockResolvedValue(awardDoc());

      const view = await service.giveMvp({
        event,
        userId: OTHER,
        awardedBy: ORGANIZER,
        replace: true,
      });

      expect(awardModel.deleteOne).toHaveBeenCalledWith({ _id: oid(AWARD_ID) });
      expect(view.recipient.id).toBe(OTHER);
    });

    it('a lost race on the unique index is MVP_ALREADY_AWARDED, not a 500', async () => {
      awardModel.create.mockRejectedValue(duplicateKey);
      expect(
        await code(
          service.giveMvp({ event, userId: PLAYER, awardedBy: ORGANIZER }),
        ),
      ).toBe('MVP_ALREADY_AWARDED');
    });

    it('a failed notification does not fail the award', async () => {
      notifications.notifyUsers.mockRejectedValue(new Error('fcm down'));
      await expect(
        service.giveMvp({ event, userId: PLAYER, awardedBy: ORGANIZER }),
      ).resolves.toMatchObject({ type: 'MVP' });
    });
  });

  describe('revokeMvp', () => {
    it('AWARD_NOT_FOUND when the event has no MVP', async () => {
      awardModel.deleteOne.mockResolvedValue({ deletedCount: 0 });
      expect(await code(service.revokeMvp(EVENT_ID))).toBe('AWARD_NOT_FOUND');
    });
  });

  describe('giveChallengeAward', () => {
    const give = () =>
      service.giveChallengeAward({
        event: { _id: oid(EVENT_ID), title: 'A FC vs B FC' },
        challengeId: CHALLENGE_ID,
        winnerGroupId: GROUP_ID,
      });

    it("freezes eligibility to the winning side's current members", async () => {
      playerModel.find.mockReturnValue(
        chain([
          { userId: oid(PLAYER) },
          { userId: oid(OTHER) },
          { userId: null },
        ]),
      );
      // OTHER played for the group but has since left it.
      memberModel.find.mockReturnValue(chain([{ userId: oid(PLAYER) }]));

      await give();

      const data = awardModel.create.mock.calls[0][0];
      expect(data).toMatchObject({
        type: 'GROUP_CHALLENGE',
        recipientKind: 'GROUP',
        title: 'A FC vs B FC – Winner',
        groupName: 'A FC',
        awardedBy: null,
      });
      expect(data.eligibleUserIds.map(String)).toEqual([PLAYER]);
      expect(playerModel.find).toHaveBeenCalledWith({
        eventId: oid(EVENT_ID),
        groupId: oid(GROUP_ID),
        status: 'joined',
      });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        [PLAYER],
        expect.objectContaining({ type: 'group', refId: GROUP_ID }),
      );
    });

    it('is idempotent — an existing award for the challenge is left alone', async () => {
      awardModel.exists.mockResolvedValue({ _id: oid(AWARD_ID) });
      await expect(give()).resolves.toBeNull();
      expect(awardModel.create).not.toHaveBeenCalled();
    });

    it('a duplicate-key race resolves to a no-op', async () => {
      awardModel.create.mockRejectedValue(duplicateKey);
      await expect(give()).resolves.toBeNull();
    });
  });

  describe('listForUser', () => {
    it('404s a private profile to others but not to its owner', async () => {
      userModel.findById.mockReturnValue(
        chain({ privacy: { profileVisibility: 'private' } }),
      );
      await expect(
        service.listForUser(PLAYER, OTHER, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.listForUser(PLAYER, PLAYER, {})).resolves.toEqual(
        expect.objectContaining({ items: [] }),
      );
    });

    it('404s a deleted account', async () => {
      userModel.findById.mockReturnValue(chain({ deletedAt: new Date() }));
      await expect(
        service.listForUser(PLAYER, PLAYER, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('merges own MVPs and memories, tagging the source', async () => {
      const groupAwardId = new Types.ObjectId();
      memoryModel.find.mockReturnValue(
        chain([{ _id: oid(MEMORY_ID), awardId: groupAwardId }]),
      );
      awardModel.find.mockReturnValue(
        chain([
          awardDoc(),
          awardDoc({
            _id: groupAwardId,
            type: 'GROUP_CHALLENGE',
            recipientKind: 'GROUP',
            recipientId: oid(GROUP_ID),
            title: 'A FC vs B FC – Winner',
            groupName: 'Old Name FC',
            awardedAt: new Date('2026-10-01T00:00:00Z'),
          }),
        ]),
      );
      // The group was deleted: its snapshot name is used.
      groupModel.find.mockReturnValue(chain([]));

      const page = await service.listForUser(PLAYER, PLAYER, {});

      expect(page.items).toEqual([
        expect.objectContaining({
          type: 'MVP',
          source: 'OWN',
          event: { id: EVENT_ID, title: 'Sunday Football' },
        }),
        expect.objectContaining({
          type: 'GROUP_CHALLENGE',
          source: 'MEMORY',
          memoryId: MEMORY_ID,
          group: { id: GROUP_ID, name: 'Old Name FC', deleted: true },
        }),
      ]);
      const filter = awardModel.find.mock.calls[0][0];
      expect(filter.$or).toHaveLength(2);
    });

    it('type=MVP skips memories; type=GROUP_CHALLENGE with none is empty', async () => {
      memoryModel.find.mockReturnValue(
        chain([{ _id: oid(MEMORY_ID), awardId: new Types.ObjectId() }]),
      );
      await service.listForUser(PLAYER, PLAYER, { type: 'MVP' });
      expect(awardModel.find.mock.calls[0][0].$or).toEqual([
        { type: 'MVP', recipientKind: 'USER', recipientId: oid(PLAYER) },
      ]);

      memoryModel.find.mockReturnValue(chain([]));
      awardModel.find.mockClear();
      const page = await service.listForUser(PLAYER, PLAYER, {
        type: 'GROUP_CHALLENGE',
      });
      expect(page.items).toEqual([]);
      expect(awardModel.find).not.toHaveBeenCalled();
    });

    it('pages newest first with a keyset cursor', async () => {
      const rows = [
        awardDoc({ _id: new Types.ObjectId() }),
        awardDoc({ _id: new Types.ObjectId() }),
      ];
      awardModel.find.mockReturnValue(chain(rows));

      const page = await service.listForUser(PLAYER, PLAYER, { limit: 1 });

      expect(page.items).toHaveLength(1);
      expect(page.hasMore).toBe(true);
      expect(decodeCursor(page.nextCursor!).i).toBe(rows[0]._id.toString());
    });
  });

  describe('listForGroup', () => {
    it('NOT_GROUP_MEMBER for outsiders', async () => {
      memberModel.exists.mockResolvedValue(null);
      expect(await code(service.listForGroup(GROUP_ID, OTHER, {}))).toBe(
        'NOT_GROUP_MEMBER',
      );
    });

    it('sets canAddAsMemory per caller', async () => {
      const added = new Types.ObjectId();
      awardModel.find.mockReturnValue(
        chain([
          awardDoc({
            type: 'GROUP_CHALLENGE',
            challengeId: oid(CHALLENGE_ID),
            eventTitle: 'A FC vs B FC',
            eligibleUserIds: [oid(PLAYER)],
          }),
          awardDoc({
            _id: added,
            type: 'GROUP_CHALLENGE',
            eligibleUserIds: [oid(PLAYER)],
          }),
          awardDoc({
            _id: new Types.ObjectId(),
            type: 'GROUP_CHALLENGE',
            eligibleUserIds: [oid(OTHER)],
          }),
        ]),
      );
      memoryModel.find.mockReturnValue(
        chain([{ _id: oid(MEMORY_ID), awardId: added }]),
      );

      const page = await service.listForGroup(GROUP_ID, PLAYER, {});

      expect(page.items.map((i) => i.canAddAsMemory)).toEqual([
        true,
        false,
        false,
      ]);
      expect(page.items[0].challenge).toEqual({
        id: CHALLENGE_ID,
        title: 'A FC vs B FC',
      });
      expect(page.items[1].memoryId).toBe(MEMORY_ID);
    });
  });

  describe('addMemory', () => {
    beforeEach(() => {
      awardModel.findOne = jest
        .fn()
        .mockReturnValue(
          chain({ _id: oid(AWARD_ID), eligibleUserIds: [oid(PLAYER)] }),
        );
    });

    it('adds it for an eligible player', async () => {
      await expect(
        service.addMemory(GROUP_ID, AWARD_ID, PLAYER),
      ).resolves.toEqual({ memoryId: MEMORY_ID, awardId: AWARD_ID });
    });

    it('NOT_ELIGIBLE_FOR_MEMORY for anyone off the frozen list', async () => {
      expect(await code(service.addMemory(GROUP_ID, AWARD_ID, OTHER))).toBe(
        'NOT_ELIGIBLE_FOR_MEMORY',
      );
    });

    it('MEMORY_EXISTS on the second add', async () => {
      memoryModel.create.mockRejectedValue(duplicateKey);
      expect(await code(service.addMemory(GROUP_ID, AWARD_ID, PLAYER))).toBe(
        'MEMORY_EXISTS',
      );
    });

    it('AWARD_NOT_FOUND for an award of another group, or a bad id', async () => {
      awardModel.findOne.mockReturnValue(chain(null));
      expect(await code(service.addMemory(GROUP_ID, AWARD_ID, PLAYER))).toBe(
        'AWARD_NOT_FOUND',
      );
      expect(await code(service.addMemory(GROUP_ID, 'nope', PLAYER))).toBe(
        'AWARD_NOT_FOUND',
      );
    });
  });

  describe('removeMemory', () => {
    it("only deletes the caller's own memory", async () => {
      await service.removeMemory(MEMORY_ID, PLAYER);
      expect(memoryModel.deleteOne).toHaveBeenCalledWith({
        _id: oid(MEMORY_ID),
        userId: oid(PLAYER),
      });
    });

    it("MEMORY_NOT_FOUND for someone else's", async () => {
      memoryModel.deleteOne.mockResolvedValue({ deletedCount: 0 });
      expect(await code(service.removeMemory(MEMORY_ID, OTHER))).toBe(
        'MEMORY_NOT_FOUND',
      );
    });
  });
});
