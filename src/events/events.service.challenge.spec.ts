// src/events/events.service.challenge.spec.ts
//
// Group Challenge: the proposal event, both-sides permissions, the assigned
// roster, and the two-team side-keeping shuffle.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { EventsService } from './events.service';
import { eventsProviders } from './events.test-providers';

const EVENT_ID = '507f1f77bcf86cd799439041';
const CHALLENGE_ID = '507f1f77bcf86cd799439042';
const GROUP_A = '507f1f77bcf86cd799439043'; // challenger
const GROUP_B = '507f1f77bcf86cd799439044'; // challenged
const ADMIN_A = '507f191e810c19729de86011';
const ADMIN_B = '507f191e810c19729de86012';
const PLAYER_A = '507f191e810c19729de86013';
const PLAYER_B = '507f191e810c19729de86014';
const STRANGER = '507f191e810c19729de86015';

describe('EventsService — group challenge', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};
  const groupModel: any = {};
  const challengeModel: any = {};
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };

  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  const challengeDoc = (over: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(CHALLENGE_ID),
    challengerGroupId: new Types.ObjectId(GROUP_A),
    challengedGroupId: new Types.ObjectId(GROUP_B),
    status: 'accepted',
    eventId: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  const eventDoc = (over: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(EVENT_ID),
    title: 'A vs B',
    type: 'challenge',
    duration: 90,
    status: 'join',
    groupId: new Types.ObjectId(GROUP_A),
    opponentGroupId: new Types.ObjectId(GROUP_B),
    challengeId: new Types.ObjectId(CHALLENGE_ID),
    proposedStatus: 'accepted',
    proposalRejectReason: null,
    createdBy: new Types.ObjectId(ADMIN_A),
    challengeColors: { challengerColor: 'red', challengedColor: 'white' },
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  /** memberModel that answers role lookups per (groupId, userId). */
  const sideMembers = () => {
    memberModel.findOne = jest.fn().mockImplementation((filter: any) => {
      const uid = filter.userId?.toString();
      const inA = (gid: string) =>
        filter.groupId?.$in
          ? filter.groupId.$in.map(String).includes(gid)
          : filter.groupId?.toString() === gid;

      const roleAsked = (role: string) =>
        !filter.role || filter.role.$in.includes(role);

      // ADMIN_A runs group A; ADMIN_B runs group B; PLAYER_A / PLAYER_B are
      // plain approved members of their sides.
      if (uid === ADMIN_A && inA(GROUP_A) && roleAsked('admin')) {
        return Promise.resolve({ role: 'admin', groupId: new Types.ObjectId(GROUP_A) });
      }
      if (uid === ADMIN_B && inA(GROUP_B) && roleAsked('admin')) {
        return Promise.resolve({ role: 'admin', groupId: new Types.ObjectId(GROUP_B) });
      }
      if (uid === PLAYER_A && inA(GROUP_A) && !filter.role) {
        return Promise.resolve({ groupId: new Types.ObjectId(GROUP_A) });
      }
      if (uid === PLAYER_B && inA(GROUP_B) && !filter.role) {
        return Promise.resolve({ groupId: new Types.ObjectId(GROUP_B) });
      }
      return Promise.resolve(null);
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.findById = jest.fn().mockResolvedValue(eventDoc());
    eventModel.updateOne = jest.fn().mockResolvedValue({});
    playerModel.findOne = jest.fn().mockResolvedValue(null);
    playerModel.create = jest.fn().mockResolvedValue({});
    playerModel.find = jest.fn().mockReturnValue(chain([]));
    groupModel.findById = jest.fn().mockReturnValue(chain({ name: 'B FC' }));
    challengeModel.findById = jest.fn().mockResolvedValue(challengeDoc());
    sideMembers();
    // notifySideAdmins fans out via find() — one admin per side is plenty.
    memberModel.find = jest
      .fn()
      .mockReturnValue(chain([{ userId: new Types.ObjectId(ADMIN_A) }]));

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          playerModel,
          memberModel,
          groupModel,
          challengeModel,
          notifications,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  describe('createChallengeEvent', () => {
    const dto: any = {
      title: 'A vs B',
      challengerColor: 'red',
      challengedColor: 'white',
    };

    it('refuses while the challenge is not accepted', async () => {
      challengeModel.findById.mockResolvedValue(
        challengeDoc({ status: 'proposed' }),
      );
      await expect(
        service.createChallengeEvent(CHALLENGE_ID, ADMIN_A, dto),
      ).rejects.toThrow(/not been accepted/);

      challengeModel.findById.mockResolvedValue(
        challengeDoc({ status: 'rejected' }),
      );
      await expect(
        service.createChallengeEvent(CHALLENGE_ID, ADMIN_A, dto),
      ).rejects.toThrow(/was rejected/);
    });

    it('one challenge, one event — a second proposal is refused', async () => {
      challengeModel.findById.mockResolvedValue(
        challengeDoc({ eventId: new Types.ObjectId(EVENT_ID) }),
      );
      await expect(
        service.createChallengeEvent(CHALLENGE_ID, ADMIN_A, dto),
      ).rejects.toThrow(/one challenge, one match/);
    });

    it('403s a caller who runs neither group', async () => {
      await expect(
        service.createChallengeEvent(CHALLENGE_ID, STRANGER, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forces privacy, stamps the challenge fields, and links back', async () => {
      const created = eventDoc({ type: 'normal', proposedStatus: null });
      const createSpy = jest
        .spyOn(service, 'create')
        .mockResolvedValue(created as any);
      const challenge = challengeDoc();
      challengeModel.findById.mockResolvedValue(challenge);

      await service.createChallengeEvent(CHALLENGE_ID, ADMIN_B, dto);

      // The event belongs to the PROPOSER's side — here B — and is private
      // whatever the caller sent.
      const [, passedDto] = createSpy.mock.calls[0];
      expect((passedDto as any).groupId).toBe(GROUP_B);
      expect((passedDto as any).isPublic).toBe(false);
      expect(passedDto).not.toHaveProperty('challengerColor');

      expect(created.type).toBe('challenge');
      expect(created.proposedStatus).toBe('proposed');
      expect(String(created.opponentGroupId)).toBe(GROUP_A);
      expect(created.challengeColors).toEqual({
        challengerColor: 'red',
        challengedColor: 'white',
      });
      expect(created.save).toHaveBeenCalled();
      expect(String(challenge.eventId)).toBe(String(created._id));
      expect(challenge.save).toHaveBeenCalled();
    });
  });

  describe('reviewProposal', () => {
    const review = (userId: string, dto: any = { action: 'accept' }) =>
      service.reviewProposal(EVENT_ID, userId, dto);

    beforeEach(() => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ proposedStatus: 'proposed' }),
      );
    });

    it('rejects a normal event — nothing to review', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ type: 'normal', opponentGroupId: null }),
      );
      await expect(review(ADMIN_B)).rejects.toThrow(/Only a challenge event/);
    });

    it('refuses a second verdict', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ proposedStatus: 'accepted' }),
      );
      await expect(review(ADMIN_B)).rejects.toThrow(/already been accepted/);
    });

    it("the PROPOSER's side cannot accept its own terms", async () => {
      // The event belongs to group A, so review rights live with group B.
      await expect(review(ADMIN_A)).rejects.toThrow(/opposing group/);
    });

    it('accept unlocks the event and tells the proposer side', async () => {
      const doc = eventDoc({ proposedStatus: 'proposed' });
      eventModel.findById.mockResolvedValue(doc);

      await review(ADMIN_B, { action: 'accept' });

      expect(doc.proposedStatus).toBe('accepted');
      expect(doc.proposalRejectReason).toBeNull();
      expect(doc.save).toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Match proposal accepted' }),
      );
    });

    it('reject stores the reason the proposer will edit against', async () => {
      const doc = eventDoc({ proposedStatus: 'proposed' });
      eventModel.findById.mockResolvedValue(doc);

      await review(ADMIN_B, { action: 'reject', reason: 'color conflict' });

      expect(doc.proposedStatus).toBe('rejected');
      expect(doc.proposalRejectReason).toBe('color conflict');
    });
  });

  describe('resubmitProposal', () => {
    it('only a REJECTED proposal can be resubmitted', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ proposedStatus: 'proposed' }),
      );
      await expect(
        service.resubmitProposal(EVENT_ID, ADMIN_A),
      ).rejects.toThrow(/still awaiting review/);

      eventModel.findById.mockResolvedValue(
        eventDoc({ proposedStatus: 'accepted' }),
      );
      await expect(
        service.resubmitProposal(EVENT_ID, ADMIN_A),
      ).rejects.toThrow(/already accepted/);
    });

    it('returns to review, clears the old reason, notifies the opponent', async () => {
      const doc = eventDoc({
        proposedStatus: 'rejected',
        proposalRejectReason: 'color conflict',
      });
      eventModel.findById.mockResolvedValue(doc);

      await service.resubmitProposal(EVENT_ID, ADMIN_A);

      expect(doc.proposedStatus).toBe('proposed');
      expect(doc.proposalRejectReason).toBeNull();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Match proposal updated' }),
      );
    });
  });

  describe('assignPlayers — curated, side-tagged roster', () => {
    const assign = (userId: string, userIds: string[]) =>
      service.assignPlayers(EVENT_ID, userId, { userIds });

    it('rejects a normal event — that roster self-joins', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ type: 'normal' }));
      await expect(assign(ADMIN_A, [PLAYER_A])).rejects.toThrow(
        /only on challenge events/,
      );
    });

    it('blocks until the proposal is accepted', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ proposedStatus: 'proposed' }),
      );
      await expect(assign(ADMIN_A, [PLAYER_A])).rejects.toThrow(
        /not been accepted/,
      );
    });

    it('403s a caller who runs neither side', async () => {
      await expect(assign(STRANGER, [PLAYER_A])).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("rejects an assignee who is not a member of the CALLER's side", async () => {
      // PLAYER_B belongs to group B; ADMIN_A can only assign group A members.
      await expect(assign(ADMIN_A, [PLAYER_B])).rejects.toThrow(
        /not an approved member of your group/,
      );
    });

    it('creates side-tagged roster rows, bumps the count, notifies', async () => {
      const res = await assign(ADMIN_A, [PLAYER_A]);

      const [row] = playerModel.create.mock.calls[0];
      expect(row.userId.toString()).toBe(PLAYER_A);
      expect(row.groupId.toString()).toBe(GROUP_A);
      expect(row.status).toBe('joined');

      expect(eventModel.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { $inc: { joinedCount: 1 } },
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: PLAYER_A, title: 'You are on the squad' }),
      );
      expect(res).toMatchObject({ assigned: [PLAYER_A], skipped: [] });
    });

    it('an already-assigned player is skipped, not an error', async () => {
      playerModel.findOne.mockResolvedValue({ status: 'joined' });

      const res = await assign(ADMIN_A, [PLAYER_A]);

      expect(res).toMatchObject({ assigned: [], skipped: [PLAYER_A] });
      expect(playerModel.create).not.toHaveBeenCalled();
      expect(eventModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('self-service roster paths are closed', () => {
    it('join is refused', async () => {
      eventModel.findById.mockReturnValue(chain(eventDoc()));
      await expect(service.join(EVENT_ID, PLAYER_A)).rejects.toThrow(
        /assigned by the group admins/,
      );
    });

    it('leave is refused', async () => {
      eventModel.findById.mockReturnValue(chain(eventDoc()));
      eventModel.findById.mockResolvedValue = undefined as any;
      eventModel.findById = jest.fn().mockReturnValue({
        lean: () => Promise.resolve(eventDoc()),
      });
      await expect(service.leave(EVENT_ID, PLAYER_A)).rejects.toThrow(
        /ask your admin to unassign you/,
      );
    });

    it('guests are refused', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(
        service.addGuest(EVENT_ID, PLAYER_A, { name: 'Plus One' } as any),
      ).rejects.toThrow(/takes no guests/);
    });
  });

  describe('shuffle keeps the sides', () => {
    it('two teams, challenger side first, nobody mixed', async () => {
      // The heavy generation path is pinned by its own specs; here the spies
      // isolate WHAT the challenge shuffle decides: team count and who lands
      // on which side.
      // Shuffling is legal during preparation.
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'preparation' }));
      // The side-split reads the challenge through a select/lean chain.
      challengeModel.findById.mockReturnValue(
        chain({ challengerGroupId: new Types.ObjectId(GROUP_A) }),
      );
      const svc: any = service;
      jest.spyOn(svc, 'joinedPlayerIds').mockResolvedValue([PLAYER_A, PLAYER_B]);
      jest.spyOn(svc, 'approvedGuestIds').mockResolvedValue([]);
      jest.spyOn(svc, 'scheduledMatchDuration').mockResolvedValue(15);
      jest.spyOn(svc, 'existingTeamNames').mockResolvedValue([]);
      const generate = jest
        .spyOn(svc, 'createTeamsAndFixtures')
        .mockResolvedValue({ teams: [{ _id: 't-red' }, { _id: 't-white' }] });
      const assignTeam = jest
        .spyOn(service, 'assignTeamPlayers')
        .mockResolvedValue({} as any);

      playerModel.find.mockReturnValue(
        chain([
          {
            userId: new Types.ObjectId(PLAYER_A),
            groupId: new Types.ObjectId(GROUP_A),
          },
          {
            userId: new Types.ObjectId(PLAYER_B),
            groupId: new Types.ObjectId(GROUP_B),
          },
        ]),
      );

      await service.shuffleTeams(EVENT_ID, ADMIN_A);

      // Locked to two teams regardless of event.teamCount.
      expect(generate.mock.calls[0][2]).toMatchObject({ teamsCount: 2 });

      // Challenger's player to the first team, challenged's to the second —
      // never dealt across.
      expect(assignTeam).toHaveBeenCalledWith(
        EVENT_ID,
        't-red',
        ADMIN_A,
        expect.objectContaining({ playerIds: [PLAYER_A], guestIds: [] }),
      );
      expect(assignTeam).toHaveBeenCalledWith(
        EVENT_ID,
        't-white',
        ADMIN_A,
        expect.objectContaining({ playerIds: [PLAYER_B], guestIds: [] }),
      );
    });
  });

  describe('team generation is locked to two sides', () => {
    it('refuses any other teamsCount for a challenge event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'preparation' }));
      await expect(
        service.generateTeams(EVENT_ID, ADMIN_A, {
          teamsCount: 4,
          numberOfPlayers: 5,
          duration: 15,
        } as any),
      ).rejects.toThrow(/exactly 2 teams/);
    });
  });

  describe('lifecycle is inert until accepted', () => {
    it('setStatus refuses while the proposal is pending', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ proposedStatus: 'proposed' }),
      );
      await expect(
        service.setStatus(EVENT_ID, ADMIN_A, 'preparation'),
      ).rejects.toThrow(/not been accepted/);
    });
  });
});
