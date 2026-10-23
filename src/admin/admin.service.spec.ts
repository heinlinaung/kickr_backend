import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AdminService } from './admin.service';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { Event } from '../events/schemas/event.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { User } from '../users/schemas/user.schema';
import { EventPayment } from '../events/schemas/event-payment.schema';
import { FinanceService } from '../finance/finance.service';

const q = (result: any) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});

describe('AdminService', () => {
  let service: AdminService;

  const groupModel: any = {};
  const memberModel: any = {};
  const eventModel: any = {};
  const playerModel: any = {};
  const userModel: any = {};
  const paymentModel: any = {};
  const financeService: any = {};

  const GROUP_ID = new Types.ObjectId().toString();
  const EVENT_ID = new Types.ObjectId().toString();
  const U1 = new Types.ObjectId().toString();
  const U2 = new Types.ObjectId().toString();
  const U3 = new Types.ObjectId().toString();

  /** all supplied ids resolve to real users */
  const usersExist = (...ids: string[]) =>
    userModel.find.mockReturnValue(q(ids.map((id) => ({ _id: id }))));

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(groupModel, { findById: jest.fn() });
    Object.assign(memberModel, {
      create: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      countDocuments: jest.fn().mockResolvedValue(0),
    });
    Object.assign(eventModel, {
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
    });
    Object.assign(playerModel, {
      create: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    });
    Object.assign(userModel, { find: jest.fn() });
    Object.assign(paymentModel, {
      findOne: jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn(),
    });
    Object.assign(financeService, {
      onPaymentReviewed: jest.fn(),
      runInTransaction: jest.fn((fn: any) => fn(null)),
    });

    const m = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(EventPayment.name), useValue: paymentModel },
        { provide: FinanceService, useValue: financeService },
      ],
    }).compile();

    service = m.get(AdminService);
  });

  describe('addGroupMembers', () => {
    it('404s for an unknown group', async () => {
      groupModel.findById.mockReturnValue(q(null));
      await expect(
        service.addGroupMembers(GROUP_ID, [U1]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('adds users as APPROVED members, bypassing owner approval', async () => {
      groupModel.findById.mockReturnValue(q({ maxPlayers: 22 }));
      usersExist(U1, U2);

      const res = await service.addGroupMembers(GROUP_ID, [U1, U2]);

      expect(res.added).toEqual([U1, U2]);
      expect(res.addedCount).toBe(2);
      const created = memberModel.create.mock.calls[0][0];
      expect(created.status).toBe('approved');
      expect(created.joinedAt).toBeInstanceOf(Date);
    });

    it('reports a per-user split rather than failing the batch', async () => {
      groupModel.findById.mockReturnValue(q({ maxPlayers: 22 }));
      usersExist(U1, U2); // U3 does not exist
      memberModel.findOne.mockImplementation(({ userId }: any) =>
        Promise.resolve(userId.toString() === U2 ? { _id: 'existing' } : null),
      );

      const res = await service.addGroupMembers(GROUP_ID, [U1, U2, U3]);

      expect(res.added).toEqual([U1]);
      expect(res.skipped).toEqual(
        expect.arrayContaining([
          { userId: U2, reason: 'already_a_member' },
          { userId: U3, reason: 'user_not_found' },
        ]),
      );
      expect(res.skippedCount).toBe(2);
    });

    it('deduplicates repeated ids', async () => {
      groupModel.findById.mockReturnValue(q({ maxPlayers: 22 }));
      usersExist(U1);

      const res = await service.addGroupMembers(GROUP_ID, [U1, U1, U1]);

      expect(res.added).toEqual([U1]);
      expect(memberModel.create).toHaveBeenCalledTimes(1);
    });

    it('respects capacity and stops mid-batch', async () => {
      groupModel.findById.mockReturnValue(q({ maxPlayers: 1 }));
      usersExist(U1, U2);

      const res = await service.addGroupMembers(GROUP_ID, [U1, U2]);

      expect(res.added).toEqual([U1]);
      expect(res.skipped).toEqual([{ userId: U2, reason: 'group_full' }]);
    });

    it('returns a 200-shaped result when everything is skipped', async () => {
      groupModel.findById.mockReturnValue(q({ maxPlayers: 22 }));
      userModel.find.mockReturnValue(q([])); // nobody exists

      const res = await service.addGroupMembers(GROUP_ID, [U1, U2]);

      expect(res.addedCount).toBe(0);
      expect(res.skippedCount).toBe(2);
    });
  });

  describe('addEventPlayers', () => {
    it('404s for an unknown event', async () => {
      eventModel.findById.mockReturnValue(q(null));
      await expect(
        service.addEventPlayers(EVENT_ID, [U1]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('adds players regardless of the lifecycle state', async () => {
      // 'done' would be rejected by the normal join path — the bypass is the point.
      eventModel.findById.mockReturnValue(
        q({ status: 'done', maxPlayers: 12 }),
      );
      usersExist(U1);
      eventModel.findOneAndUpdate.mockResolvedValue({ joinedCount: 1 });

      const res = await service.addEventPlayers(EVENT_ID, [U1]);

      expect(res.added).toEqual([U1]);
      expect(playerModel.create).toHaveBeenCalled();
    });

    it('increments joinedCount atomically per add, so it cannot drift', async () => {
      eventModel.findById.mockReturnValue(q({ maxPlayers: 12 }));
      usersExist(U1, U2);
      eventModel.findOneAndUpdate.mockResolvedValue({ joinedCount: 1 });

      await service.addEventPlayers(EVENT_ID, [U1, U2]);

      expect(eventModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
      const [filter, update] = eventModel.findOneAndUpdate.mock.calls[0];
      // capacity guarded in the filter, not checked separately
      expect(filter.$expr).toEqual({
        $lt: ['$joinedCount', '$maxPlayers'],
      });
      expect(update).toEqual({ $inc: { joinedCount: 1 } });
    });

    it('skips when the atomic capacity guard does not match', async () => {
      eventModel.findById.mockReturnValue(q({ maxPlayers: 1 }));
      usersExist(U1);
      eventModel.findOneAndUpdate.mockResolvedValue(null); // full

      const res = await service.addEventPlayers(EVENT_ID, [U1]);

      expect(res.skipped).toEqual([{ userId: U1, reason: 'event_full' }]);
      expect(playerModel.create).not.toHaveBeenCalled();
    });

    it('skips an already-joined player without touching joinedCount', async () => {
      eventModel.findById.mockReturnValue(q({ maxPlayers: 12 }));
      usersExist(U1);
      playerModel.findOne.mockResolvedValue({ status: 'joined' });

      const res = await service.addEventPlayers(EVENT_ID, [U1]);

      expect(res.skipped).toEqual([{ userId: U1, reason: 'already_joined' }]);
      expect(eventModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('reactivates a cancelled row instead of inserting a duplicate', async () => {
      eventModel.findById.mockReturnValue(q({ maxPlayers: 12 }));
      usersExist(U1);
      const cancelled = { status: 'cancelled', save: jest.fn() };
      playerModel.findOne.mockResolvedValue(cancelled);
      eventModel.findOneAndUpdate.mockResolvedValue({ joinedCount: 1 });

      const res = await service.addEventPlayers(EVENT_ID, [U1]);

      expect(res.added).toEqual([U1]);
      expect(cancelled.status).toBe('joined');
      expect(cancelled.save).toHaveBeenCalled();
      // unique {eventId,userId} index would reject an insert here
      expect(playerModel.create).not.toHaveBeenCalled();
    });
  });

  describe('markEventPaymentsPaid', () => {
    const event = { createdBy: U3, groupId: null, price: 100 };

    it('404s for an unknown event', async () => {
      eventModel.findById.mockReturnValue(q(null));
      await expect(
        service.markEventPaymentsPaid(EVENT_ID, [U1]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('writes an approved row covering the price for joined players', async () => {
      eventModel.findById.mockReturnValue(q(event));
      usersExist(U1);
      playerModel.findOne.mockResolvedValue({ status: 'joined' });

      const res = await service.markEventPaymentsPaid(EVENT_ID, [U1]);

      expect(res.added).toEqual([U1]);
      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set).toMatchObject({
        method: 'cash',
        status: 'approved',
        amount: 100,
        paidAmount: 100,
      });
      expect(update.$set.reviewedBy.toString()).toBe(U3);
    });

    it('skips players not joined and those already fully paid', async () => {
      eventModel.findById.mockReturnValue(q(event));
      usersExist(U1, U2);
      playerModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ status: 'joined' });
      paymentModel.findOne.mockResolvedValue({
        status: 'approved',
        paidAmount: 100,
      });

      const res = await service.markEventPaymentsPaid(EVENT_ID, [U1, U2]);

      expect(res.skipped).toEqual([
        { userId: U1, reason: 'not_joined' },
        { userId: U2, reason: 'already_paid' },
      ]);
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('posts to the group fund for a group event', async () => {
      eventModel.findById.mockReturnValue(
        q({ ...event, groupId: new Types.ObjectId(GROUP_ID) }),
      );
      groupModel.findById.mockReturnValue(q({ cashierId: U2 }));
      usersExist(U1);
      playerModel.findOne.mockResolvedValue({ status: 'joined' });

      await service.markEventPaymentsPaid(EVENT_ID, [U1]);

      expect(financeService.onPaymentReviewed).toHaveBeenCalledWith(null, {
        eventId: EVENT_ID,
        memberId: U1,
        paidBeforeCents: 0,
        paidAfterCents: 10000,
        reviewerId: U2,
      });
    });
  });
});
