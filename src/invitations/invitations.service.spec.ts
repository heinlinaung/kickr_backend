import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InvitationsService } from './invitations.service';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { GroupsService } from '../groups/groups.service';

describe('InvitationsService', () => {
  let service: InvitationsService;

  const groupModel: any = {};
  const memberModel: any = {};
  const groupsService: any = {};

  const GROUP_ID = new Types.ObjectId();
  const USER_ID = new Types.ObjectId().toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(groupModel, { findById: jest.fn(), findOne: jest.fn() });
    Object.assign(memberModel, {
      create: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    });
    Object.assign(groupsService, { assertOwnerOrAdmin: jest.fn() });

    const m = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: GroupsService, useValue: groupsService },
      ],
    }).compile();

    service = m.get(InvitationsService);
  });

  describe('joinByCode — requires approval (spec v3 §14 #5)', () => {
    const validGroup = (over: Record<string, unknown> = {}) => ({
      _id: GROUP_ID,
      maxPlayers: 22,
      ...over,
    });

    it('creates a PENDING member, not an approved one', async () => {
      groupModel.findOne.mockResolvedValue(validGroup());
      memberModel.findOne.mockResolvedValue(null);

      const res: any = await service.joinByCode('code-1', USER_ID);

      const created = memberModel.create.mock.calls[0][0];
      expect(created.status).toBe('pending');
      expect(created.role).toBe('member');
      expect(res.status).toBe('pending');
    });

    it('does NOT set joinedAt — that is stamped on approval', async () => {
      groupModel.findOne.mockResolvedValue(validGroup());
      memberModel.findOne.mockResolvedValue(null);

      await service.joinByCode('code-1', USER_ID);

      expect(memberModel.create.mock.calls[0][0].joinedAt).toBeUndefined();
    });

    it('no longer claims the user joined', async () => {
      groupModel.findOne.mockResolvedValue(validGroup());
      memberModel.findOne.mockResolvedValue(null);

      const res: any = await service.joinByCode('code-1', USER_ID);

      expect(res.message).toMatch(/waiting for approval/i);
      expect(res.message).not.toMatch(/joined group successfully/i);
    });

    // Capacity moved to approval time: a full group may have space by review.
    it('accepts a request even when the group is already full', async () => {
      groupModel.findOne.mockResolvedValue(validGroup({ maxPlayers: 1 }));
      memberModel.findOne.mockResolvedValue(null);
      memberModel.countDocuments.mockResolvedValue(1);

      const res: any = await service.joinByCode('code-1', USER_ID);

      expect(res.status).toBe('pending');
      expect(memberModel.create).toHaveBeenCalled();
    });

    it('still rejects an invalid or expired code', async () => {
      groupModel.findOne.mockResolvedValue(null);
      await expect(
        service.joinByCode('bad-code', USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(memberModel.create).not.toHaveBeenCalled();
    });

    it('still rejects a duplicate request', async () => {
      groupModel.findOne.mockResolvedValue(validGroup());
      memberModel.findOne.mockResolvedValue({ _id: 'existing' });

      await expect(
        service.joinByCode('code-1', USER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(memberModel.create).not.toHaveBeenCalled();
    });

    it('produces the same membership shape as requestToJoin', async () => {
      groupModel.findOne.mockResolvedValue(validGroup());
      groupModel.findById.mockResolvedValue(validGroup());
      memberModel.findOne.mockResolvedValue(null);

      await service.joinByCode('code-1', USER_ID);
      const byCode = memberModel.create.mock.calls[0][0];

      memberModel.create.mockClear();
      await service.requestToJoin(GROUP_ID.toString(), USER_ID);
      const byRequest = memberModel.create.mock.calls[0][0];

      expect(byCode.status).toBe(byRequest.status);
      expect(byCode.role).toBe(byRequest.role);
    });
  });
});
