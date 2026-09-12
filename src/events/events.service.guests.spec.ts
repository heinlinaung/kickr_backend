// src/events/events.service.guests.spec.ts
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
const SPONSOR = '507f191e810c19729de860eb';
const OTHER = '507f191e810c19729de860ec';
const GUEST_ROW = '507f1f77bcf86cd7994390f1';

describe('EventsService — guests (+1 / +2)', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};

  const eventDoc = (over: Record<string, unknown> = {}) => {
    const doc: any = {
      _id: new Types.ObjectId(EVENT_ID),
      createdBy: new Types.ObjectId(CREATOR),
      groupId: null,
      status: 'join',
      joinedCount: 4,
      maxPlayers: 10,
      isAllowExtraPlayer: true,
      ...over,
    };
    // Different call sites chain differently: assertOrganizer awaits the
    // result, listGuests does .select().lean(), leave() does .lean().
    doc.select = () => ({ lean: () => Promise.resolve(doc) });
    doc.lean = () => Promise.resolve(doc);
    return doc;
  };

  const guestDoc = (over: Record<string, unknown> = {}) => {
    const doc: any = {
      _id: new Types.ObjectId(GUEST_ROW),
      eventId: new Types.ObjectId(EVENT_ID),
      type: 'guest',
      guestName: 'John',
      addedByUserId: new Types.ObjectId(SPONSOR),
      approval: 'pending',
      status: 'joined',
      save: jest.fn().mockImplementation(function (this: any) {
        return Promise.resolve(this);
      }),
      toJSON: jest.fn().mockImplementation(function (this: any) {
        const { save, toJSON, select, ...rest } = this;
        return rest;
      }),
      ...over,
    };
    return doc;
  };

  /** find(...).populate(...).sort(...).lean() */
  const chain = (rows: any[]) => ({
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // assertOrganizer awaits findById(); listGuests chains .select().lean().
    // The double has to answer both shapes.
    eventModel.findById = jest.fn().mockImplementation(() => {
      const doc = eventDoc();
      return Object.assign(Promise.resolve(doc), doc);
    });
    eventModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    // The sponsor is on the roster by default.
    // addGuest populates the sponsor's name to derive a default guestName, so
    // the double answers both a bare await and a .populate() chain.
    const sponsorRow: any = { status: 'joined', userId: { name: 'Thant' } };
    sponsorRow.populate = () => Promise.resolve(sponsorRow);
    playerModel.findOne = jest
      .fn()
      .mockReturnValue(Object.assign(Promise.resolve(sponsorRow), sponsorRow));
    playerModel.countDocuments = jest.fn().mockResolvedValue(0);
    playerModel.create = jest
      .fn()
      .mockImplementation((doc: any) => ({ ...doc, toJSON: () => doc }));
    playerModel.find = jest.fn().mockReturnValue(chain([]));
    playerModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    memberModel.findOne = jest.fn().mockResolvedValue(null);

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({ eventModel, playerModel, memberModel }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  describe('addGuest', () => {
    const add = (sponsor = SPONSOR, guestName = 'John') =>
      service.addGuest(EVENT_ID, sponsor, { guestName });

    it('creates the guest PENDING and off the roster count', async () => {
      await add();

      const created = playerModel.create.mock.calls[0][0];
      expect(created.type).toBe('guest');
      expect(created.approval).toBe('pending');
      expect(created.guestName).toBe('John');
      expect(created.addedByUserId.toString()).toBe(SPONSOR);
      // Capacity moves on APPROVAL, not on submission.
      expect(eventModel.updateOne).not.toHaveBeenCalled();
    });

    it('stores no userId — a guest is never a fake account', async () => {
      await add();
      expect(playerModel.create.mock.calls[0][0].userId).toBeUndefined();
    });

    it('trims the name', async () => {
      await add(SPONSOR, '  John  ');
      expect(playerModel.create.mock.calls[0][0].guestName).toBe('John');
    });

    describe('the per-member cap', () => {
      // Reported as "the system only allows one guest player". The cap is
      // MAX_GUESTS_PER_MEMBER = 2, and these pin the boundary directly rather
      // than leaving it inferred from the guestName sequence tests.
      const add = () => service.addGuest(EVENT_ID, SPONSOR, {} as any);

      it('allows the FIRST guest', async () => {
        playerModel.countDocuments.mockResolvedValue(0);

        await expect(add()).resolves.toBeDefined();
        expect(playerModel.create).toHaveBeenCalled();
      });

      it('allows the SECOND guest', async () => {
        // The reported failure. If this passes, a "+2 is refused" report is
        // NOT the application cap — look at the database index instead: a
        // legacy plain unique {eventId, userId} makes every guest collide on
        // (eventId, null), so only the first can ever insert.
        playerModel.countDocuments.mockResolvedValue(1);

        await expect(add()).resolves.toBeDefined();
        expect(playerModel.create).toHaveBeenCalled();
      });

      it('refuses the THIRD', async () => {
        playerModel.countDocuments.mockResolvedValue(2);

        await expect(add()).rejects.toThrow(/at most 2 guests/);
        expect(playerModel.create).not.toHaveBeenCalled();
      });

      it('counts only guests this sponsor brought', async () => {
        // Another member's guests must not eat into this member's allowance.
        playerModel.countDocuments.mockResolvedValue(0);

        await add();

        const filter = playerModel.countDocuments.mock.calls[0][0];
        expect(String(filter.addedByUserId)).toBe(SPONSOR);
      });

      it('does not count REJECTED guests against the allowance', async () => {
        // A refused guest never plays, so holding a slot would silently cost
        // the sponsor part of their allowance.
        playerModel.countDocuments.mockResolvedValue(0);

        await add();

        const filter = playerModel.countDocuments.mock.calls[0][0];
        expect(filter.approval).toEqual({ $ne: 'rejected' });
      });
    });

    describe('owner/admin have no allowance cap', () => {
      // NOTE: the shared event double has groupId: null, which short-circuits
      // the manager lookup entirely — so these build their own group event.
      // Without that, every test here would pass while exercising nothing.
      const GROUP = '6a6b2366f78b66d63a911a9e';

      const groupEvent = () => {
        eventModel.findById = jest.fn().mockResolvedValue({
          _id: EVENT_ID,
          status: 'join',
          isAllowExtraPlayer: true,
          groupId: new Types.ObjectId(GROUP),
          maxPlayers: 22,
        });
      };

      const asManager = (is: boolean) => {
        memberModel.exists = jest.fn().mockResolvedValue(is ? { _id: 'm' } : null);
      };

      const add = () => service.addGuest(EVENT_ID, SPONSOR, {} as any);

      it('lets an owner/admin past the +2 limit', async () => {
        groupEvent();
        asManager(true);
        // Already at the member cap; a manager is not bound by it.
        playerModel.countDocuments.mockResolvedValue(5);

        await expect(add()).resolves.toBeDefined();
        expect(playerModel.create).toHaveBeenCalled();
      });

      it('does not even count a manager\'s existing guests', async () => {
        // The allowance query is skipped, not merely ignored — one fewer round
        // trip on the path that will add the most guests.
        groupEvent();
        asManager(true);
        playerModel.countDocuments.mockClear();

        await add();

        // The ALLOWANCE query has no `type` — the remaining call that does is
        // the guestName sequence lookup, which a manager still needs.
        const allowanceCalls = playerModel.countDocuments.mock.calls.filter(
          (c: any[]) =>
            c[0]?.addedByUserId !== undefined && c[0]?.type === undefined,
        );
        expect(allowanceCalls).toHaveLength(0);
      });

      it('still caps an ordinary member of the same group', async () => {
        groupEvent();
        asManager(false);
        playerModel.countDocuments.mockResolvedValue(2);

        await expect(add()).rejects.toThrow(/at most 2 guests/);
      });

      it('checks for an APPROVED owner/admin membership', async () => {
        // A pending request must not confer the raised allowance.
        groupEvent();
        asManager(true);

        await add();

        const filter = memberModel.exists.mock.calls[0][0];
        expect(filter.status).toBe('approved');
        expect(filter.role.$in).toEqual(['owner', 'admin']);
      });

      it('caps the creator of a GROUPLESS event', async () => {
        // Deliberately narrower than assertOrganizer, which also accepts the
        // creator: creating an event is not a position of trust in the group,
        // so anyone able to create one would otherwise self-grant an unlimited
        // allowance.
        playerModel.countDocuments.mockResolvedValue(2);

        await expect(add()).rejects.toThrow(/at most 2 guests/);
      });
    });

    describe('default guestName', () => {
      const addWithout = (sponsor = SPONSOR) =>
        service.addGuest(EVENT_ID, sponsor, {} as any);

      it('derives it from the sponsor name and a sequence number', async () => {
        playerModel.countDocuments.mockResolvedValue(0);

        await addWithout();

        expect(playerModel.create.mock.calls[0][0].guestName).toBe(
          'Thant guest 1',
        );
      });

      it('numbers the second guest 2', async () => {
        playerModel.countDocuments.mockResolvedValue(1);

        await addWithout();

        expect(playerModel.create.mock.calls[0][0].guestName).toBe(
          'Thant guest 2',
        );
      });

      it('numbers from every guest ever added, so names never repeat', async () => {
        // Sequencing off the ALLOWANCE count would reuse "guest 1" after a
        // rejection, colliding with the rejected row's name.
        playerModel.countDocuments.mockResolvedValue(0);
        await addWithout();

        // Two counts: one for the cap, one for the sequence. The sequence one
        // must not filter on approval or status.
        const sequenceQuery = playerModel.countDocuments.mock.calls[1][0];
        expect(sequenceQuery.approval).toBeUndefined();
        expect(sequenceQuery.status).toBeUndefined();
        expect(sequenceQuery.type).toBe('guest');
      });

      it('an explicit name still wins', async () => {
        await service.addGuest(EVENT_ID, SPONSOR, { guestName: 'John' });
        expect(playerModel.create.mock.calls[0][0].guestName).toBe('John');
      });

      it('falls back when the sponsor has no readable name', async () => {
        const row: any = { status: 'joined', userId: null };
        row.populate = () => Promise.resolve(row);
        playerModel.findOne.mockReturnValue(
          Object.assign(Promise.resolve(row), row),
        );
        playerModel.countDocuments.mockResolvedValue(0);

        await addWithout();

        expect(playerModel.create.mock.calls[0][0].guestName).toBe('Guest 1');
      });
    });

    describe('isAllowExtraPlayer', () => {
      const withFlag = (isAllowExtraPlayer: unknown) => {
        const d = eventDoc({ isAllowExtraPlayer });
        eventModel.findById.mockReturnValue(
          Object.assign(Promise.resolve(d), d),
        );
      };

      it('refuses when the event does not allow extra players', async () => {
        withFlag(false);

        await expect(
          service.addGuest(EVENT_ID, SPONSOR, { guestName: 'John' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(playerModel.create).not.toHaveBeenCalled();
      });

      it('refuses when the flag is absent, so guests are opt-in', async () => {
        // Events created before this flag existed have no value, which reads
        // as false — a capability switch should be off until asked for.
        withFlag(undefined);

        await expect(
          service.addGuest(EVENT_ID, SPONSOR, { guestName: 'John' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('allows guests when the organizer enabled it', async () => {
        withFlag(true);

        await expect(
          service.addGuest(EVENT_ID, SPONSOR, { guestName: 'John' }),
        ).resolves.toBeDefined();
      });

      it('checks the flag before the roster, so the message is the useful one', async () => {
        // A non-member on a guests-disabled event should hear "this event does
        // not allow guests", not "join first" — joining would not help.
        withFlag(false);
        playerModel.findOne.mockReturnValue({
          populate: () => Promise.resolve(null),
        });

        await expect(
          service.addGuest(EVENT_ID, SPONSOR, { guestName: 'John' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('requires the sponsor to have joined', async () => {
      // A guest is somebody else's plus-one; an organizer who never joined has
      // no allowance of their own. The lookup now chains .populate(), so the
      // "absent" double has to answer that and still resolve to null.
      playerModel.findOne.mockReturnValue({
        populate: () => Promise.resolve(null),
      });
      await expect(add()).rejects.toBeInstanceOf(ForbiddenException);
      expect(playerModel.create).not.toHaveBeenCalled();
    });

    it('caps a member at two guests', async () => {
      playerModel.countDocuments.mockResolvedValue(2);
      await expect(add()).rejects.toBeInstanceOf(BadRequestException);
      expect(playerModel.create).not.toHaveBeenCalled();
    });

    it('does not count rejected guests against the cap', async () => {
      // Otherwise a member could add, be rejected, and never retry.
      await add();
      expect(playerModel.countDocuments.mock.calls[0][0].approval).toEqual({
        $ne: 'rejected',
      });
    });

    it.each(['preparation', 'ready_to_play', 'playing', 'after_match', 'done'])(
      'refuses once the event is %s',
      async (status) => {
        const d = eventDoc({ status });
      eventModel.findById.mockReturnValue(Object.assign(Promise.resolve(d), d));
        await expect(add()).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('404s an unknown event', async () => {
      eventModel.findById.mockResolvedValue(null);
      await expect(add()).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setGuestApproval', () => {
    const decide = (approval: any, requester = CREATOR) =>
      service.setGuestApproval(EVENT_ID, requester, GUEST_ROW, { approval });

    it('approving puts the guest on the roster and counts them', async () => {
      const guest = guestDoc({ approval: 'pending' });
      playerModel.findOne.mockResolvedValue(guest);

      await decide('approved');

      expect(guest.approval).toBe('approved');
      const [, update] = eventModel.updateOne.mock.calls[0];
      expect(update).toEqual({ $inc: { joinedCount: 1 } });
    });

    it('lets an approved guest push the event past maxPlayers', async () => {
      // Soft limit by decision: a guest arriving with a member is a fact on
      // the ground, not a booking to validate.
      const d = eventDoc({ joinedCount: 10, maxPlayers: 10 });
      eventModel.findById.mockReturnValue(Object.assign(Promise.resolve(d), d));
      playerModel.findOne.mockResolvedValue(guestDoc({ approval: 'pending' }));

      await expect(decide('approved')).resolves.toBeDefined();
      expect(eventModel.updateOne).toHaveBeenCalled();
    });

    it('rejecting does not touch the count', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc({ approval: 'pending' }));

      await decide('rejected');

      expect(eventModel.updateOne).not.toHaveBeenCalled();
    });

    it('reversing an approval gives the capacity back', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc({ approval: 'approved' }));

      await decide('rejected');

      const [filter, update] = eventModel.updateOne.mock.calls[0];
      expect(update).toEqual({ $inc: { joinedCount: -1 } });
      expect(filter.joinedCount).toEqual({ $gt: 0 });
    });

    it('is idempotent — re-approving does not count twice', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc({ approval: 'approved' }));

      await decide('approved');

      expect(eventModel.updateOne).not.toHaveBeenCalled();
    });

    it('403s a non-organizer', async () => {
      await expect(decide('approved', OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('404s a guest that is not on this event', async () => {
      playerModel.findOne.mockResolvedValue(null);
      await expect(decide('approved')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('scopes the lookup to guests of this event', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc());
      await decide('approved');

      const q = playerModel.findOne.mock.calls[0][0];
      expect(q.eventId.toString()).toBe(EVENT_ID);
      expect(q.type).toBe('guest');
    });

    it('400s a malformed guest id', async () => {
      await expect(
        service.setGuestApproval(EVENT_ID, CREATOR, 'nope', {
          approval: 'approved',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('removeGuest', () => {
    it('lets the sponsor withdraw their own guest', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc());

      await expect(
        service.removeGuest(EVENT_ID, SPONSOR, GUEST_ROW),
      ).resolves.toBeDefined();

      // Cancelled, not deleted — the record of who was brought survives.
      const [, update] = playerModel.updateMany.mock.calls[0];
      expect(update).toEqual({ $set: { status: 'cancelled' } });
    });

    it('lets an organizer withdraw someone else\'s guest', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc());
      await expect(
        service.removeGuest(EVENT_ID, CREATOR, GUEST_ROW),
      ).resolves.toBeDefined();
    });

    it('403s an unrelated member', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc());
      await expect(
        service.removeGuest(EVENT_ID, OTHER, GUEST_ROW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(playerModel.updateMany).not.toHaveBeenCalled();
    });

    it('gives capacity back only for an APPROVED guest', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc({ approval: 'approved' }));
      await service.removeGuest(EVENT_ID, SPONSOR, GUEST_ROW);

      const [, update] = eventModel.updateOne.mock.calls[0];
      expect(update).toEqual({ $inc: { joinedCount: -1 } });
    });

    it('does not decrement for a pending guest, who never counted', async () => {
      playerModel.findOne.mockResolvedValue(guestDoc({ approval: 'pending' }));
      await service.removeGuest(EVENT_ID, SPONSOR, GUEST_ROW);

      expect(eventModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe("cascade — a guest leaves with their sponsor", () => {
    const sponsorRow = () => ({
      status: 'joined',
      save: jest.fn().mockResolvedValue({}),
    });

    it('cancels the guests of a member who leaves', async () => {
      // A guest exists only as somebody's plus-one: nobody vouching, nobody
      // paying, nobody to arrive with.
      const d = eventDoc({ status: 'join' });
      eventModel.findById.mockReturnValue(Object.assign(Promise.resolve(d), d));
      eventModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
      playerModel.findOne.mockResolvedValue(sponsorRow());
      playerModel.find.mockResolvedValue([
        guestDoc({ approval: 'approved' }),
        guestDoc({ approval: 'pending' }),
      ]);

      const res: any = await service.leave(EVENT_ID, SPONSOR);

      expect(res.guestsRemoved).toBe(2);
      const [, update] = playerModel.updateMany.mock.calls[0];
      expect(update).toEqual({ $set: { status: 'cancelled' } });
    });

    it('returns capacity only for the APPROVED guests', async () => {
      // One approved of two, so the event gets exactly one slot back.
      const d = eventDoc({ status: 'join' });
      eventModel.findById.mockReturnValue(Object.assign(Promise.resolve(d), d));
      eventModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
      playerModel.findOne.mockResolvedValue(sponsorRow());
      playerModel.find.mockResolvedValue([
        guestDoc({ approval: 'approved' }),
        guestDoc({ approval: 'pending' }),
      ]);

      await service.leave(EVENT_ID, SPONSOR);

      const [, update] = eventModel.updateOne.mock.calls[0];
      expect(update).toEqual({ $inc: { joinedCount: -1 } });
    });

    it('looks the guests up by SPONSOR, not by the guest row', async () => {
      const d = eventDoc({ status: 'join' });
      eventModel.findById.mockReturnValue(Object.assign(Promise.resolve(d), d));
      eventModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
      playerModel.findOne.mockResolvedValue(sponsorRow());
      playerModel.find.mockResolvedValue([]);

      await service.leave(EVENT_ID, SPONSOR);

      const q = playerModel.find.mock.calls[0][0];
      expect(q.addedByUserId.toString()).toBe(SPONSOR);
      expect(q.status).toBe('joined');
    });

    it('cascades when an ORGANIZER removes the member too', async () => {
      const d = eventDoc({ status: 'join' });
      eventModel.findById.mockReturnValue(Object.assign(Promise.resolve(d), d));
      eventModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
      playerModel.findOne.mockResolvedValue(sponsorRow());
      playerModel.find.mockResolvedValue([guestDoc({ approval: 'approved' })]);

      const res: any = await service.removePlayer(EVENT_ID, CREATOR, SPONSOR);

      expect(res.guestsRemoved).toBe(1);
      expect(playerModel.updateMany).toHaveBeenCalled();
    });

    it('is a no-op for a member who brought nobody', async () => {
      const d = eventDoc({ status: 'join' });
      eventModel.findById.mockReturnValue(Object.assign(Promise.resolve(d), d));
      eventModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
      playerModel.findOne.mockResolvedValue(sponsorRow());
      playerModel.find.mockResolvedValue([]);

      const res: any = await service.leave(EVENT_ID, SPONSOR);

      expect(res.guestsRemoved).toBe(0);
      expect(playerModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listGuests', () => {
    it('shows an organizer every guest', async () => {
      await service.listGuests(EVENT_ID, CREATOR);

      const filter = playerModel.find.mock.calls[0][0];
      expect(filter.type).toBe('guest');
      expect(filter.$or).toBeUndefined();
    });

    it('shows a member approved guests plus their own', async () => {
      await service.listGuests(EVENT_ID, OTHER);

      const filter = playerModel.find.mock.calls[0][0];
      expect(filter.$or).toEqual([
        { approval: 'approved' },
        { addedByUserId: expect.anything() },
      ]);
    });

    it('never populates the sponsor email', async () => {
      const c = chain([]);
      playerModel.find.mockReturnValue(c);

      await service.listGuests(EVENT_ID, CREATOR);

      const fields = c.populate.mock.calls[0][1] as string;
      expect(fields.split(' ')).not.toContain('email');
    });
  });
});
