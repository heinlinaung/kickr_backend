// src/events/events.service.payments.spec.ts
//
// Payment After Event: member submits (cash claim, or bank transfer with a
// receipt), the group's CASHIER reviews — event creator for non-group
// events. Replaced organizer direct-marking on 2026-10-03.
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
const GROUP_ID = '507f1f77bcf86cd799439012';
const CREATOR = '507f191e810c19729de860ea';
const CASHIER = '507f191e810c19729de860eb';
const MEMBER = '507f191e810c19729de860ec';
const STRANGER = '507f191e810c19729de860ed';

describe('EventsService — member payments (submit/review)', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const paymentModel: any = {};
  const memberModel: any = {};
  const groupModel: any = {};
  const imagekit = {
    upload: jest
      .fn()
      .mockResolvedValue({ url: 'https://ik/p.jpg', fileId: 'fid1' }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const finance = {
    runInTransaction: jest.fn((fn: (s: null) => unknown) => fn(null)),
    onPaymentReviewed: jest.fn().mockResolvedValue(undefined),
  };

  /** find(...).populate(...).sort(...).lean() */
  const listChain = (rows: any[]) => ({
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  });

  const eventDoc = (over: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(EVENT_ID),
    title: 'Friday Night',
    createdBy: new Types.ObjectId(CREATOR),
    groupId: new Types.ObjectId(GROUP_ID),
    status: 'join',
    ...over,
  });

  /** findById serving all three shapes: await doc, .select().lean(). */
  const mockEvent = (over: Record<string, any> = {}) => {
    eventModel.findById = jest.fn().mockImplementation(() => {
      const doc: any = eventDoc(over);
      doc.select = () => ({ lean: () => Promise.resolve(doc) });
      return Object.assign(Promise.resolve(doc), doc);
    });
  };

  const file = { buffer: Buffer.from('img') } as Express.Multer.File;

  beforeEach(async () => {
    jest.clearAllMocks();
    imagekit.upload.mockResolvedValue({
      url: 'https://ik/p.jpg',
      fileId: 'fid1',
    });
    mockEvent();
    playerModel.findOne = jest.fn().mockResolvedValue({ status: 'joined' });
    paymentModel.find = jest.fn().mockReturnValue(listChain([]));
    paymentModel.findOne = jest.fn().mockResolvedValue(null);
    paymentModel.findOneAndUpdate = jest
      .fn()
      .mockResolvedValue({ status: 'submitted' });
    memberModel.findOne = jest.fn().mockResolvedValue(null);
    groupModel.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest
        .fn()
        .mockResolvedValue({ cashierId: new Types.ObjectId(CASHIER) }),
    });

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          playerModel,
          paymentModel,
          memberModel,
          groupModel,
          imagekit,
          notifications,
          finance,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  const submit = (
    userId = MEMBER,
    dto: any = { method: 'cash' },
    proof?: Express.Multer.File,
  ) => service.submitPayment(EVENT_ID, userId, dto, proof);

  const review = (requesterId = CASHIER, dto: any = { action: 'approve' }) =>
    service.reviewPayment(EVENT_ID, requesterId, MEMBER, dto);

  describe('submitPayment', () => {
    it('400s a caller who never joined the roster', async () => {
      playerModel.findOne.mockResolvedValue(null);
      await expect(submit()).rejects.toThrow(/joined this event/);
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('requires a receipt image for a bank transfer', async () => {
      await expect(submit(MEMBER, { method: 'bank_transfer' })).rejects.toThrow(
        /receipt image/,
      );
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('uploads the bank-transfer proof and stores it on the row', async () => {
      await submit(MEMBER, { method: 'bank_transfer' }, file);

      expect(imagekit.upload).toHaveBeenCalledWith(
        file.buffer,
        expect.stringContaining(EVENT_ID),
        'payment-proofs',
      );
      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set).toMatchObject({
        method: 'bank_transfer',
        status: 'submitted',
        proofUrl: 'https://ik/p.jpg',
        proofFileId: 'fid1',
      });
    });

    it('a cash claim carries no proof, even if a file is sent', async () => {
      // A stray image on a cash claim must not be stored as if it proved
      // anything.
      await submit(MEMBER, { method: 'cash' }, file);

      expect(imagekit.upload).not.toHaveBeenCalled();
      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set).toMatchObject({
        method: 'cash',
        proofUrl: null,
        proofFileId: null,
      });
    });

    it('upserts on (event, member) and voids any previous verdict', async () => {
      await submit();

      const [filter, update, options] =
        paymentModel.findOneAndUpdate.mock.calls[0];
      expect(filter.eventId.toString()).toBe(EVENT_ID);
      expect(filter.memberId.toString()).toBe(MEMBER);
      expect(options).toMatchObject({ upsert: true, new: true });
      expect(update.$set).toMatchObject({
        reviewedBy: null,
        reviewedAt: null,
        rejectReason: null,
      });
      expect(update.$set.submittedAt).toBeInstanceOf(Date);
    });

    it('refuses once the payment is approved — it is settled', async () => {
      paymentModel.findOne.mockResolvedValue({ status: 'approved' });
      await expect(submit()).rejects.toThrow(/already approved/);
    });

    it('resubmission after a rejection replaces the old proof file', async () => {
      paymentModel.findOne.mockResolvedValue({
        status: 'rejected',
        proofFileId: 'oldFid',
      });

      await submit(MEMBER, { method: 'bank_transfer' }, file);

      expect(imagekit.deleteFile).toHaveBeenCalledWith('oldFid');
      expect(paymentModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('records what the submission is for, but never the price itself', async () => {
      mockEvent({ price: 100, additionalPrice: 20, takeAdditionalPrice: true });
      await submit();
      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      // The event still owns the price…
      for (const field of ['price', 'additionalPrice', 'updatedPrice']) {
        expect(update.$set).not.toHaveProperty(field);
      }
      // …the row records the balance this claim covers (Event Funds).
      expect(update.$set.amount).toBe(120);
      expect(update.$set.paidAmount).toBe(0);
    });

    it('lets a part-paid member top up the difference after a price rise', async () => {
      mockEvent({ price: 120, updatedPrice: 150 });
      paymentModel.findOne = jest.fn().mockResolvedValue({
        status: 'approved',
        amount: 120,
        paidAmount: 120,
        proofFileId: 'approvedFid',
      });

      await submit(MEMBER, { method: 'bank_transfer' }, file);

      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set).toMatchObject({
        status: 'submitted',
        amount: 30,
        paidAmount: 120,
      });
      // The approved receipt is evidence for money already counted.
      expect(imagekit.deleteFile).not.toHaveBeenCalled();
    });

    it('still refuses an approved member who owes nothing', async () => {
      mockEvent({ price: 120 });
      paymentModel.findOne = jest
        .fn()
        .mockResolvedValue({
          status: 'approved',
          amount: 120,
          paidAmount: 120,
        });
      await expect(submit()).rejects.toThrow(BadRequestException);
    });

    it('notifies the group cashier that a review is waiting', async () => {
      await submit();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: CASHIER, type: 'event' }),
      );
    });

    it('notifies the creator instead for a non-group event', async () => {
      mockEvent({ groupId: null });
      await submit();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: CREATOR }),
      );
    });
  });

  describe('reviewPayment', () => {
    const submittedRow = () => ({
      status: 'submitted',
      rejectReason: null,
      reviewedBy: null,
      reviewedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('blocks a group with NO cashier — appoint one first', async () => {
      groupModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ cashierId: null }),
      });
      await expect(review(CREATOR)).rejects.toThrow(/no cashier yet/);
    });

    it('403s anyone but the cashier on a group event — the owner included', async () => {
      paymentModel.findOne.mockResolvedValue(submittedRow());
      await expect(review(CREATOR)).rejects.toThrow(/Only the group cashier/);
      await expect(review(STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the cashier approve, stamping who and when', async () => {
      const row = submittedRow();
      paymentModel.findOne.mockResolvedValue(row);

      await review(CASHIER, { action: 'approve' });

      expect(row.save).toHaveBeenCalled();
      expect(row).toMatchObject({ status: 'approved', rejectReason: null });
      expect(String(row.reviewedBy)).toBe(CASHIER);
      expect(row.reviewedAt).toBeInstanceOf(Date);
    });

    it('approving adds the submission to paidAmount and tells Event Funds', async () => {
      mockEvent({ price: 120 });
      const row = { ...submittedRow(), amount: 120, paidAmount: 0 };
      paymentModel.findOne.mockResolvedValue(row);

      await review(CASHIER, { action: 'approve' });

      expect(row.paidAmount).toBe(120);
      expect(finance.onPaymentReviewed).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          eventId: EVENT_ID,
          memberId: MEMBER,
          paidBeforeCents: 0,
          paidAfterCents: 12000,
          reviewerId: CASHIER,
        }),
      );
    });

    it('un-approving takes the submission back out of paidAmount', async () => {
      mockEvent({ price: 120 });
      const row = {
        ...submittedRow(),
        status: 'approved',
        amount: 120,
        paidAmount: 120,
      };
      paymentModel.findOne.mockResolvedValue(row);

      await review(CASHIER, { action: 'reject', reason: 'Bounced' });

      expect(row.paidAmount).toBe(0);
      expect(finance.onPaymentReviewed).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ paidBeforeCents: 12000, paidAfterCents: 0 }),
      );
    });

    it('a legacy approved row (no paidAmount) counts as the full fee', async () => {
      mockEvent({ price: 120 });
      const row = { ...submittedRow(), status: 'approved' };
      paymentModel.findOne.mockResolvedValue(row);

      await review(CASHIER, { action: 'reject', reason: 'Never arrived' });

      expect(finance.onPaymentReviewed).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ paidBeforeCents: 12000, paidAfterCents: 0 }),
      );
    });

    it('a rejection keeps the reason for the member to see', async () => {
      const row = submittedRow();
      paymentModel.findOne.mockResolvedValue(row);

      await review(CASHIER, { action: 'reject', reason: 'Wrong amount' });

      expect(row).toMatchObject({
        status: 'rejected',
        rejectReason: 'Wrong amount',
      });
    });

    it('non-group events: the creator reviews, nobody else', async () => {
      mockEvent({ groupId: null });
      const row = submittedRow();
      paymentModel.findOne.mockResolvedValue(row);

      await expect(
        service.reviewPayment(EVENT_ID, STRANGER, MEMBER, {
          action: 'approve',
        } as any),
      ).rejects.toThrow(/Only the event creator/);
      await expect(
        service.reviewPayment(EVENT_ID, CREATOR, MEMBER, {
          action: 'approve',
        } as any),
      ).resolves.toBeDefined();
    });

    it('404s when the member never submitted', async () => {
      paymentModel.findOne.mockResolvedValue(null);
      await expect(review()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s a malformed member id', async () => {
      await expect(
        service.reviewPayment(EVENT_ID, CASHIER, 'not-an-id', {
          action: 'approve',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('tells the member the verdict', async () => {
      paymentModel.findOne.mockResolvedValue(submittedRow());
      await review(CASHIER, { action: 'reject', reason: 'Blurry screenshot' });

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: MEMBER,
          title: 'Payment rejected',
          body: expect.stringContaining('Blurry screenshot'),
        }),
      );
    });
  });

  describe('listPayments', () => {
    const OTHER = '507f191e810c19729de860ee';
    const id = (v: string) => new Types.ObjectId(v);

    /** Roster of MEMBER + OTHER; event costs 100. */
    const setup = (payments: any[] = []) => {
      mockEvent({ price: 100 });
      playerModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest
          .fn()
          .mockResolvedValue([{ userId: id(MEMBER) }, { userId: id(OTHER) }]),
      });
      paymentModel.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(payments),
      });
    };
    const approved = (memberId: string) => ({
      memberId: id(memberId),
      status: 'approved',
      paidAmount: 100,
    });

    it('gives the event creator (organizer) every member', async () => {
      setup();
      await service.listPayments(EVENT_ID, CREATOR);
      expect(paymentModel.find.mock.calls[0][0].memberId).toBeUndefined();
      expect(playerModel.find.mock.calls[0][0].userId).not.toBeInstanceOf(
        Types.ObjectId,
      );
    });

    it('gives the CASHIER every member too — they review them', async () => {
      setup();
      await service.listPayments(EVENT_ID, CASHIER);
      expect(paymentModel.find.mock.calls[0][0].memberId).toBeUndefined();
    });

    it('narrows anyone else to their own line', async () => {
      setup();
      await service.listPayments(EVENT_ID, STRANGER);
      expect(paymentModel.find.mock.calls[0][0].memberId.toString()).toBe(
        STRANGER,
      );
      expect(playerModel.find.mock.calls[0][0].userId.toString()).toBe(
        STRANGER,
      );
    });

    it('lists a member with no submission as unpaid', async () => {
      setup([approved(MEMBER)]);
      const page = await service.listPayments(EVENT_ID, CREATOR);
      expect(
        page.items.map((l: any) => [l.member._id.toString(), l.paymentStatus]),
      ).toEqual([
        [MEMBER, 'paid'],
        [OTHER, 'unpaid'],
      ]);
      expect(page.items[1].payment).toBeNull();
      expect(page.items[1].balanceStatus).toBe('UNPAID');
    });

    it('filters by ?status=paid and ?status=unpaid', async () => {
      setup([approved(MEMBER), { memberId: id(OTHER), status: 'submitted' }]);
      const paid = await service.listPayments(EVENT_ID, CREATOR, {
        status: 'paid',
      });
      expect(paid.items.map((l: any) => l.member._id.toString())).toEqual([
        MEMBER,
      ]);

      const unpaid = await service.listPayments(EVENT_ID, CREATOR, {
        status: 'unpaid',
      });
      expect(unpaid.items.map((l: any) => l.member._id.toString())).toEqual([
        OTHER,
      ]);
      expect(unpaid.items[0].balanceStatus).toBe('PENDING');
    });

    it('pages by cursor without repeating or skipping', async () => {
      setup();
      const first = await service.listPayments(EVENT_ID, CREATOR, { limit: 1 });
      expect(first.hasMore).toBe(true);
      expect(first.items[0].member._id.toString()).toBe(MEMBER);

      const second = await service.listPayments(EVENT_ID, CREATOR, {
        limit: 1,
        cursor: first.nextCursor!,
      });
      expect(second.items[0].member._id.toString()).toBe(OTHER);
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).toBeNull();
    });

    it('400s a garbage cursor', async () => {
      setup();
      await expect(
        service.listPayments(EVENT_ID, CREATOR, { cursor: 'nope' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s an unknown event', async () => {
      eventModel.findById = jest.fn().mockReturnValue({
        select: () => ({ lean: () => Promise.resolve(null) }),
      });
      await expect(
        service.listPayments(EVENT_ID, CREATOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

});
