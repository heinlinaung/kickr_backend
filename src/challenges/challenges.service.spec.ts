// src/challenges/challenges.service.spec.ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ChallengesService } from './challenges.service';
import { Challenge } from './schemas/challenge.schema';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { NotificationsService } from '../notifications/notifications.service';

const GROUP_A = '507f1f77bcf86cd799439031';
const GROUP_B = '507f1f77bcf86cd799439032';
const ADMIN_A = '507f191e810c19729de86001';
const ADMIN_B = '507f191e810c19729de86002';
const CHALLENGE_ID = '507f1f77bcf86cd799439033';

describe('ChallengesService', () => {
  let service: ChallengesService;
  const challengeModel: any = {};
  const groupModel: any = {};
  const memberModel: any = {};
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };

  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  const challengeDoc = (over: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(CHALLENGE_ID),
    challengerGroupId: new Types.ObjectId(GROUP_A),
    challengedGroupId: new Types.ObjectId(GROUP_B),
    status: 'proposed',
    rejectReason: null,
    respondedBy: null,
    respondedAt: null,
    eventId: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    groupModel.findById = jest.fn().mockReturnValue(chain({ name: 'A FC' }));
    // Caller holds owner/admin wherever asked, by default.
    memberModel.findOne = jest.fn().mockResolvedValue({
      role: 'admin',
      userId: new Types.ObjectId(ADMIN_A),
    });
    memberModel.find = jest.fn().mockReturnValue(
      chain([{ userId: new Types.ObjectId(ADMIN_B) }]),
    );
    challengeModel.exists = jest.fn().mockResolvedValue(null);
    challengeModel.create = jest.fn().mockResolvedValue(challengeDoc());
    challengeModel.findById = jest.fn().mockResolvedValue(challengeDoc());
    challengeModel.find = jest.fn().mockReturnValue(chain([]));

    const m = await Test.createTestingModule({
      providers: [
        ChallengesService,
        { provide: getModelToken(Challenge.name), useValue: challengeModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = m.get(ChallengesService);
  });

  const create = (over: Record<string, string> = {}) =>
    service.create(ADMIN_A, {
      challengerGroupId: GROUP_A,
      challengedGroupId: GROUP_B,
      ...over,
    });

  describe('create', () => {
    it('rejects a self-challenge', async () => {
      await expect(create({ challengedGroupId: GROUP_A })).rejects.toThrow(
        /cannot challenge itself/,
      );
    });

    it('404s when either group is missing', async () => {
      groupModel.findById.mockReturnValue(chain(null));
      await expect(create()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403s a caller who is not a challenger-group owner/admin', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(create()).rejects.toThrow(/challenger group/);
      expect(challengeModel.create).not.toHaveBeenCalled();
    });

    it('refuses while a challenge between the pair is still pending — either direction', async () => {
      challengeModel.exists.mockResolvedValue({ _id: 'c0' });

      await expect(create()).rejects.toThrow(/already a pending challenge/);

      const [filter] = challengeModel.exists.mock.calls[0];
      expect(filter.status).toBe('proposed');
      expect(filter.$or).toHaveLength(2); // A->B and B->A both count
    });

    it("creates the row and notifies the challenged side's admins", async () => {
      await create();

      const [doc] = challengeModel.create.mock.calls[0];
      expect(doc.challengerGroupId.toString()).toBe(GROUP_A);
      expect(doc.challengedGroupId.toString()).toBe(GROUP_B);
      expect(doc.createdBy.toString()).toBe(ADMIN_A);

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ADMIN_B,
          title: 'New challenge',
          type: 'group',
        }),
      );
    });
  });

  describe('respond', () => {
    const respond = (dto: any = { action: 'accept' }, userId = ADMIN_B) =>
      service.respond(CHALLENGE_ID, userId, dto);

    it('404s an unknown challenge', async () => {
      challengeModel.findById.mockResolvedValue(null);
      await expect(respond()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a second verdict — the handshake is not a toggle', async () => {
      challengeModel.findById.mockResolvedValue(
        challengeDoc({ status: 'accepted' }),
      );
      await expect(respond()).rejects.toThrow(/already been accepted/);
    });

    it('403s anyone but a challenged-group owner/admin', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(respond()).rejects.toBeInstanceOf(ForbiddenException);
      // The gate asks about the CHALLENGED group specifically.
      const [filter] = memberModel.findOne.mock.calls[0];
      expect(filter.groupId.toString()).toBe(GROUP_B);
    });

    it('accept stamps who and when, and tells the challenger side', async () => {
      const doc = challengeDoc();
      challengeModel.findById.mockResolvedValue(doc);

      await respond({ action: 'accept' });

      expect(doc.status).toBe('accepted');
      expect(doc.rejectReason).toBeNull();
      expect(String(doc.respondedBy)).toBe(ADMIN_B);
      expect(doc.save).toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Challenge accepted' }),
      );
    });

    it('reject keeps the optional reason for the challenger to read', async () => {
      const doc = challengeDoc();
      challengeModel.findById.mockResolvedValue(doc);

      await respond({ action: 'reject', reason: 'Squad is away' });

      expect(doc.status).toBe('rejected');
      expect(doc.rejectReason).toBe('Squad is away');
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Squad is away'),
        }),
      );
    });
  });

  describe('listForGroup', () => {
    it('403s a non-member — the handshake is group business', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.listForGroup(GROUP_A, ADMIN_B),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reads both directions for the group', async () => {
      await service.listForGroup(GROUP_A, ADMIN_A);

      const [filter] = challengeModel.find.mock.calls[0];
      expect(filter.$or).toHaveLength(2);
      expect(filter.$or[0].challengerGroupId.toString()).toBe(GROUP_A);
      expect(filter.$or[1].challengedGroupId.toString()).toBe(GROUP_A);
    });

    it('400s a malformed group id before touching the db', async () => {
      await expect(
        service.listForGroup('nope', ADMIN_A),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(challengeModel.find).not.toHaveBeenCalled();
    });
  });
});
