// src/events/events.service.payments.spec.ts
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
const CREATOR = '507f191e810c19729de860ea';
const STRANGER = '507f191e810c19729de860eb';
const MEMBER = '507f191e810c19729de860ec';

describe('EventsService — member payments', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const paymentModel: any = {};
  const memberModel: any = {};

  /** find(...).populate(...).sort(...).lean() */
  const chain = (rows: any[]) => ({
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  });

  const eventDoc = () => ({
    _id: new Types.ObjectId(EVENT_ID),
    createdBy: new Types.ObjectId(CREATOR),
    groupId: null,
    status: 'join',
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // assertOrganizer uses findById(); listPayments uses findById().select().lean()
    eventModel.findById = jest.fn().mockImplementation(() => {
      const doc: any = eventDoc();
      doc.select = () => ({ lean: () => Promise.resolve(doc) });
      return Object.assign(Promise.resolve(doc), doc);
    });
    playerModel.findOne = jest.fn().mockResolvedValue({ status: 'joined' });
    paymentModel.find = jest.fn().mockReturnValue(chain([]));
    paymentModel.findOneAndUpdate = jest
      .fn()
      .mockResolvedValue({ isPaid: true });
    memberModel.findOne = jest.fn().mockResolvedValue(null);

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          playerModel,
          paymentModel,
          memberModel,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  describe('setPayment', () => {
    it('upserts, so the first call creates the record', async () => {
      await service.setPayment(EVENT_ID, CREATOR, MEMBER, { isPaid: true });

      const [, , options] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(options.upsert).toBe(true);
      expect(options.new).toBe(true);
    });

    it('keys the row on the event AND the member', async () => {
      await service.setPayment(EVENT_ID, CREATOR, MEMBER, { isPaid: true });

      const [filter] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(filter.eventId.toString()).toBe(EVENT_ID);
      expect(filter.memberId.toString()).toBe(MEMBER);
    });

    it('stamps paidAt when marking paid', async () => {
      await service.setPayment(EVENT_ID, CREATOR, MEMBER, { isPaid: true });

      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set.isPaid).toBe(true);
      expect(update.$set.paidAt).toBeInstanceOf(Date);
    });

    it('clears paidAt when reversing a payment', async () => {
      // Otherwise a reversed payment keeps a date and reads as paid.
      await service.setPayment(EVENT_ID, CREATOR, MEMBER, { isPaid: false });

      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set.isPaid).toBe(false);
      expect(update.$set.paidAt).toBeNull();
    });

    it('records who marked it', async () => {
      await service.setPayment(EVENT_ID, CREATOR, MEMBER, { isPaid: true });

      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set.recordedBy.toString()).toBe(CREATOR);
    });

    it('stores no amount — the event owns the price', async () => {
      await service.setPayment(EVENT_ID, CREATOR, MEMBER, { isPaid: true });

      const [, update] = paymentModel.findOneAndUpdate.mock.calls[0];
      for (const field of ['amount', 'price', 'additionalPrice']) {
        expect(update.$set).not.toHaveProperty(field);
      }
    });

    it('403s a non-organizer before writing', async () => {
      await expect(
        service.setPayment(EVENT_ID, STRANGER, MEMBER, { isPaid: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('404s a member who has not joined', async () => {
      playerModel.findOne.mockResolvedValue(null);

      await expect(
        service.setPayment(EVENT_ID, CREATOR, MEMBER, { isPaid: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('400s a malformed member id', async () => {
      await expect(
        service.setPayment(EVENT_ID, CREATOR, 'not-an-id', { isPaid: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listPayments', () => {
    it('gives an organizer every row', async () => {
      await service.listPayments(EVENT_ID, CREATOR);

      const filter = paymentModel.find.mock.calls[0][0];
      expect(filter.memberId).toBeUndefined();
    });

    it('narrows a non-organizer to their own row', async () => {
      // A member has no business reading who else has paid.
      await service.listPayments(EVENT_ID, STRANGER);

      const filter = paymentModel.find.mock.calls[0][0];
      expect(filter.memberId.toString()).toBe(STRANGER);
    });

    it('never populates the member email', async () => {
      const c = chain([]);
      paymentModel.find.mockReturnValue(c);

      await service.listPayments(EVENT_ID, CREATOR);

      const fields = c.populate.mock.calls[0][1] as string;
      expect(fields.split(' ')).not.toContain('email');
      expect(fields.split(' ')).toContain('name');
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
