import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FriendsService } from './friends.service';
import { Friendship } from './schemas/friendship.schema';
import { EventInvitation } from './schemas/event-invitation.schema';
import { pairKeyOf } from './friends.helpers';
import { User } from '../users/schemas/user.schema';
import { Event } from '../events/schemas/event.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { Award } from '../awards/schemas/award.schema';
import { AwardMemory } from '../awards/schemas/award-memory.schema';
import { AwardsService } from '../awards/awards.service';

/** A thenable query stub: chain methods return itself, await yields `value`. */
function q<T>(value: T): any {
  const chain: any = {
    select: () => chain,
    lean: () => chain,
    sort: () => chain,
    limit: () => chain,
    then: (res: any, rej: any) => Promise.resolve(value).then(res, rej),
  };
  return chain;
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return ((e as HttpException).getResponse() as { code?: string }).code;
  }
  return undefined;
}

describe('FriendsService', () => {
  let service: FriendsService;

  const friendshipModel: any = {};
  const invitationModel: any = {};
  const userModel: any = {};
  const empty: any = {};

  const ME = new Types.ObjectId();
  const THEM = new Types.ObjectId();
  const STRANGER = new Types.ObjectId();
  const me = ME.toString();
  const them = THEM.toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(friendshipModel, {
      findOne: jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn(),
      findOneAndDelete: jest.fn(),
      findById: jest.fn(),
      exists: jest.fn().mockResolvedValue(null),
      countDocuments: jest.fn().mockResolvedValue(0),
      create: jest.fn(async (doc) => ({
        _id: new Types.ObjectId(),
        createdAt: new Date(),
        ...doc,
      })),
    });
    Object.assign(invitationModel, { updateMany: jest.fn() });
    Object.assign(userModel, {
      findById: jest.fn(() => q({ _id: THEM, deletedAt: null })),
    });

    const m = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: getModelToken(Friendship.name), useValue: friendshipModel },
        {
          provide: getModelToken(EventInvitation.name),
          useValue: invitationModel,
        },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Event.name), useValue: empty },
        { provide: getModelToken(EventPlayer.name), useValue: empty },
        { provide: getModelToken(Group.name), useValue: empty },
        { provide: getModelToken(GroupMember.name), useValue: empty },
        { provide: getModelToken(Award.name), useValue: empty },
        { provide: getModelToken(AwardMemory.name), useValue: empty },
        { provide: AwardsService, useValue: {} },
      ],
    }).compile();

    service = m.get(FriendsService);
  });

  describe('sendRequest', () => {
    it('rejects a request to yourself', async () => {
      expect(await codeOf(service.sendRequest(me, me))).toBe(
        'CANNOT_FRIEND_SELF',
      );
    });

    it('rejects an unknown or deleted user', async () => {
      userModel.findById.mockReturnValue(q({ deletedAt: new Date() }));
      expect(await codeOf(service.sendRequest(me, them))).toBe(
        'USER_NOT_FOUND',
      );
    });

    it('creates a PENDING request keyed on the order-free pair', async () => {
      const res = await service.sendRequest(me, them);

      expect(res.created).toBe(true);
      expect(res.friendship.status).toBe('PENDING');
      const doc = friendshipModel.create.mock.calls[0][0];
      expect(doc.pairKey).toBe(pairKeyOf(them, me));
      expect(doc.active).toBe(true);
    });

    it('accepts at once when they already asked me', async () => {
      const theirs = {
        _id: new Types.ObjectId(),
        requesterId: THEM,
        addresseeId: ME,
        status: 'PENDING',
      };
      friendshipModel.findOne.mockResolvedValue(theirs);
      friendshipModel.findOneAndUpdate.mockReturnValue(
        q({ ...theirs, status: 'ACCEPTED', respondedAt: new Date() }),
      );

      const res = await service.sendRequest(me, them);

      expect(res.created).toBe(false);
      expect(res.friendship.status).toBe('ACCEPTED');
      expect(friendshipModel.create).not.toHaveBeenCalled();
    });

    it('rejects when already friends', async () => {
      friendshipModel.findOne.mockResolvedValue({
        status: 'ACCEPTED',
        requesterId: ME,
      });
      expect(await codeOf(service.sendRequest(me, them))).toBe(
        'ALREADY_FRIENDS',
      );
    });

    it('rejects a second pending request from me', async () => {
      friendshipModel.findOne.mockResolvedValue({
        status: 'PENDING',
        requesterId: ME,
      });
      expect(await codeOf(service.sendRequest(me, them))).toBe(
        'REQUEST_ALREADY_EXISTS',
      );
    });

    it('enforces the 30-day cooldown after a rejection', async () => {
      friendshipModel.exists.mockResolvedValue({ _id: 'rejected' });
      expect(await codeOf(service.sendRequest(me, them))).toBe(
        'REQUEST_ALREADY_EXISTS',
      );
      expect(friendshipModel.create).not.toHaveBeenCalled();
    });

    it('enforces the daily request limit', async () => {
      friendshipModel.countDocuments.mockResolvedValue(50);
      friendshipModel.findOne
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce(q({ createdAt: new Date() }));
      expect(await codeOf(service.sendRequest(me, them))).toBe('RATE_LIMITED');
    });
  });

  describe('respondToRequest', () => {
    const request = {
      _id: new Types.ObjectId(),
      requesterId: ME,
      addresseeId: THEM,
      status: 'PENDING',
    };

    it('only lets the addressee answer', async () => {
      friendshipModel.findById.mockReturnValue(q(request));
      expect(
        await codeOf(
          service.respondToRequest(me, request._id.toString(), 'ACCEPTED'),
        ),
      ).toBe('NOT_REQUEST_ADDRESSEE');
    });

    it('hides the request from users outside it', async () => {
      friendshipModel.findById.mockReturnValue(q(request));
      expect(
        await codeOf(
          service.respondToRequest(
            STRANGER.toString(),
            request._id.toString(),
            'ACCEPTED',
          ),
        ),
      ).toBe('REQUEST_NOT_FOUND');
    });

    it('frees the pair on rejection', async () => {
      friendshipModel.findById.mockReturnValue(q(request));
      friendshipModel.findOneAndUpdate.mockReturnValue(
        q({ ...request, status: 'REJECTED' }),
      );

      await service.respondToRequest(them, request._id.toString(), 'REJECTED');

      const update = friendshipModel.findOneAndUpdate.mock.calls[0][1];
      expect(update.$set).toMatchObject({ status: 'REJECTED', active: false });
    });

    it('reports a request that was already answered', async () => {
      friendshipModel.findById.mockReturnValue(q(request));
      friendshipModel.findOneAndUpdate.mockReturnValue(q(null));
      expect(
        await codeOf(
          service.respondToRequest(them, request._id.toString(), 'ACCEPTED'),
        ),
      ).toBe('REQUEST_NOT_PENDING');
    });
  });

  describe('unfriend', () => {
    it('revokes pending invitations in both directions', async () => {
      friendshipModel.findOneAndDelete.mockResolvedValue({ _id: 'f1' });

      await service.unfriend(me, them);

      const [filter, update] = invitationModel.updateMany.mock.calls[0];
      expect(filter.status).toBe('PENDING');
      expect(filter.$or).toEqual([
        { inviterId: ME, inviteeId: THEM },
        { inviterId: THEM, inviteeId: ME },
      ]);
      expect(update.$set.status).toBe('REVOKED');
    });

    it('rejects when not friends', async () => {
      friendshipModel.findOneAndDelete.mockResolvedValue(null);
      expect(await codeOf(service.unfriend(me, them))).toBe('NOT_FRIENDS');
      expect(invitationModel.updateMany).not.toHaveBeenCalled();
    });
  });
});
