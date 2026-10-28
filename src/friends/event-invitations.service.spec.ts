import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EventInvitationsService } from './event-invitations.service';
import { Friendship } from './schemas/friendship.schema';
import { EventInvitation } from './schemas/event-invitation.schema';
import { pairKeyOf } from './friends.helpers';
import { User } from '../users/schemas/user.schema';
import { Event } from '../events/schemas/event.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Group } from '../groups/schemas/group.schema';
import { NotificationsService } from '../notifications/notifications.service';

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

describe('EventInvitationsService', () => {
  let service: EventInvitationsService;

  const invitationModel: any = {};
  const friendshipModel: any = {};
  const eventModel: any = {};
  const playerModel: any = {};
  const groupModel: any = {};
  const userModel: any = {};
  const notifications: any = {};

  const ME = new Types.ObjectId();
  const me = ME.toString();
  const EVENT_ID = new Types.ObjectId();
  const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

  const openEvent = (over: Record<string, unknown> = {}) => ({
    _id: EVENT_ID,
    title: 'Sunday Run',
    type: 'normal',
    status: 'join',
    date: tomorrow(),
    startTime: null,
    maxPlayers: 12,
    joinedCount: 3,
    createdBy: new Types.ObjectId(),
    groupId: new Types.ObjectId(),
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(invitationModel, {
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(async () => ({ _id: 'claimed' })),
      countDocuments: jest.fn().mockResolvedValue(0),
      distinct: jest.fn().mockResolvedValue([]),
      create: jest.fn(async (doc) => ({ _id: new Types.ObjectId(), ...doc })),
    });
    Object.assign(friendshipModel, { find: jest.fn(() => q([])) });
    Object.assign(eventModel, {
      findById: jest.fn(() => q(openEvent())),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
    });
    Object.assign(playerModel, {
      exists: jest.fn().mockResolvedValue({ _id: 'row' }),
      distinct: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    });
    Object.assign(groupModel, { find: jest.fn(() => q([])) });
    Object.assign(userModel, {
      findById: jest.fn(() => q({ name: 'Ploy' })),
    });
    Object.assign(notifications, { notifyUsers: jest.fn() });

    const m = await Test.createTestingModule({
      providers: [
        EventInvitationsService,
        {
          provide: getModelToken(EventInvitation.name),
          useValue: invitationModel,
        },
        { provide: getModelToken(Friendship.name), useValue: friendshipModel },
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = m.get(EventInvitationsService);
  });

  describe('invite', () => {
    it('requires the inviter to be on the event', async () => {
      playerModel.exists.mockResolvedValue(null);
      expect(
        await codeOf(
          service.invite(me, EVENT_ID.toString(), { userIds: ['x'] } as any),
        ),
      ).toBe('NOT_EVENT_PARTICIPANT');
    });

    it('lets the organizer invite without a roster row', async () => {
      eventModel.findById.mockReturnValue(q(openEvent({ createdBy: ME })));
      playerModel.exists.mockResolvedValue(null);
      const res = await service.invite(me, EVENT_ID.toString(), {
        userIds: [new Types.ObjectId().toString()],
      });
      expect(res.results).toHaveLength(1);
    });

    it.each([
      ['started', { status: 'playing' }],
      ['cancelled', { status: 'cancelled' }],
      ['past its start', { date: new Date(Date.now() - 1000) }],
      ['a challenge match', { type: 'challenge' }],
    ])('rejects an event that is %s', async (_label, over) => {
      eventModel.findById.mockReturnValue(q(openEvent(over)));
      expect(
        await codeOf(
          service.invite(me, EVENT_ID.toString(), { userIds: ['x'] } as any),
        ),
      ).toBe('EVENT_CLOSED');
    });

    it('checks each invitee on its own, in rule order', async () => {
      const friend = new Types.ObjectId().toString();
      const stranger = new Types.ObjectId().toString();
      const joinedFriend = new Types.ObjectId().toString();
      const invitedFriend = new Types.ObjectId().toString();
      friendshipModel.find.mockReturnValue(
        q(
          [friend, joinedFriend, invitedFriend].map((id) => ({
            pairKey: pairKeyOf(me, id),
          })),
        ),
      );
      playerModel.distinct.mockResolvedValue([
        new Types.ObjectId(joinedFriend),
      ]);
      invitationModel.distinct.mockResolvedValue([
        new Types.ObjectId(invitedFriend),
      ]);

      const { results } = await service.invite(me, EVENT_ID.toString(), {
        userIds: [friend, stranger, joinedFriend, invitedFriend],
        message: 'Join us!',
      });

      expect(results.map((r) => r.status)).toEqual([
        'INVITED',
        'FAILED',
        'FAILED',
        'FAILED',
      ]);
      expect(results.slice(1).map((r: any) => r.error.code)).toEqual([
        'NOT_FRIENDS',
        'ALREADY_PARTICIPANT',
        'INVITATION_EXISTS',
      ]);
      expect(invitationModel.create).toHaveBeenCalledTimes(1);
      expect(invitationModel.create.mock.calls[0][0].message).toBe('Join us!');
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        [friend],
        expect.objectContaining({ type: 'event', refId: EVENT_ID.toString() }),
      );
    });

    it('never looks at group membership', async () => {
      const friend = new Types.ObjectId().toString();
      friendshipModel.find.mockReturnValue(
        q([{ pairKey: pairKeyOf(me, friend) }]),
      );

      const { results } = await service.invite(me, EVENT_ID.toString(), {
        userIds: [friend],
      });

      expect(results[0].status).toBe('INVITED');
      expect(groupModel.find).not.toHaveBeenCalled();
    });

    it('fails friends with EVENT_FULL when no spot is left', async () => {
      const friend = new Types.ObjectId().toString();
      eventModel.findById.mockReturnValue(
        q(openEvent({ maxPlayers: 4, joinedCount: 4 })),
      );
      friendshipModel.find.mockReturnValue(
        q([{ pairKey: pairKeyOf(me, friend) }]),
      );

      const { results } = await service.invite(me, EVENT_ID.toString(), {
        userIds: [friend],
      });

      expect((results[0] as any).error.code).toBe('EVENT_FULL');
    });

    it('enforces the daily invitation limit', async () => {
      invitationModel.countDocuments.mockResolvedValue(199);
      invitationModel.findOne = jest.fn(() => q({ createdAt: new Date() }));
      expect(
        await codeOf(
          service.invite(me, EVENT_ID.toString(), {
            userIds: [
              new Types.ObjectId().toString(),
              new Types.ObjectId().toString(),
            ],
          }),
        ),
      ).toBe('RATE_LIMITED');
    });
  });

  describe('accept', () => {
    const INV_ID = new Types.ObjectId();
    const pending = (over: Record<string, unknown> = {}) => ({
      _id: INV_ID,
      eventId: EVENT_ID,
      inviterId: new Types.ObjectId(),
      inviteeId: ME,
      status: 'PENDING',
      ...over,
    });

    it("hides other users' invitations", async () => {
      invitationModel.findById.mockReturnValue(
        q(pending({ inviteeId: new Types.ObjectId() })),
      );
      expect(await codeOf(service.accept(me, INV_ID.toString()))).toBe(
        'INVITATION_NOT_FOUND',
      );
    });

    it('takes a seat, claims the invitation and adds the roster row', async () => {
      invitationModel.findById.mockReturnValue(q(pending()));
      eventModel.findOneAndUpdate.mockResolvedValue(openEvent());

      const res = await service.accept(me, INV_ID.toString());

      expect(res).toEqual({
        id: INV_ID.toString(),
        status: 'ACCEPTED',
        eventId: EVENT_ID.toString(),
      });
      expect(eventModel.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $inc: { joinedCount: 1 },
      });
      expect(
        invitationModel.findOneAndUpdate.mock.calls[0][1].$set.status,
      ).toBe('ACCEPTED');
      expect(playerModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ME, status: 'joined' }),
      );
    });

    it('leaves the invitation pending when the event is full', async () => {
      invitationModel.findById.mockReturnValue(q(pending()));
      eventModel.findOneAndUpdate.mockResolvedValue(null);

      expect(await codeOf(service.accept(me, INV_ID.toString()))).toBe(
        'EVENT_FULL',
      );
      expect(invitationModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(playerModel.create).not.toHaveBeenCalled();
    });

    it('expires the invitation when the event has closed', async () => {
      invitationModel.findById.mockReturnValue(q(pending()));
      eventModel.findById.mockReturnValue(q(openEvent({ status: 'done' })));

      expect(await codeOf(service.accept(me, INV_ID.toString()))).toBe(
        'EVENT_CLOSED',
      );
      expect(
        invitationModel.findOneAndUpdate.mock.calls[0][1].$set.status,
      ).toBe('EXPIRED');
    });

    it('hands the seat back when the invitation was answered meanwhile', async () => {
      invitationModel.findById.mockReturnValue(q(pending()));
      eventModel.findOneAndUpdate.mockResolvedValue(openEvent());
      invitationModel.findOneAndUpdate.mockResolvedValue(null);

      expect(await codeOf(service.accept(me, INV_ID.toString()))).toBe(
        'INVITATION_NOT_PENDING',
      );
      expect(eventModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: EVENT_ID }),
        { $inc: { joinedCount: -1 } },
      );
      expect(playerModel.create).not.toHaveBeenCalled();
    });

    it('rejects an invitation that is no longer pending', async () => {
      invitationModel.findById.mockReturnValue(
        q(pending({ status: 'REVOKED' })),
      );
      expect(await codeOf(service.accept(me, INV_ID.toString()))).toBe(
        'INVITATION_NOT_PENDING',
      );
    });
  });

  describe('revoke', () => {
    it('only lets the inviter revoke', async () => {
      const INV_ID = new Types.ObjectId();
      invitationModel.findById.mockReturnValue(
        q({ _id: INV_ID, inviterId: new Types.ObjectId(), inviteeId: ME }),
      );
      expect(await codeOf(service.revoke(me, INV_ID.toString()))).toBe(
        'NOT_INVITATION_OWNER',
      );
    });
  });
});
