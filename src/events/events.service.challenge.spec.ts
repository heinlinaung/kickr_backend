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
  const teamModel: any = {};
  const matchModel: any = {};
  const teamChatModel: any = {};
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
        return Promise.resolve({
          role: 'admin',
          groupId: new Types.ObjectId(GROUP_A),
        });
      }
      if (uid === ADMIN_B && inA(GROUP_B) && roleAsked('admin')) {
        return Promise.resolve({
          role: 'admin',
          groupId: new Types.ObjectId(GROUP_B),
        });
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
          teamModel,
          matchModel,
          teamChatModel,
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

    it('maxPlayers is OPTIONAL: unset stays null, never the default cap', async () => {
      // The roster is admin-assigned with no min/max, so the schema default
      // (12, for self-join events) must not sneak in and read as "full".
      const created: any = eventDoc({ maxPlayers: 12 }); // schema default applied
      jest.spyOn(service, 'create').mockResolvedValue(created);

      await service.createChallengeEvent(CHALLENGE_ID, ADMIN_A, dto);

      expect(created.maxPlayers).toBeNull();
    });

    it('an explicit maxPlayers from the proposer is kept', async () => {
      const created: any = eventDoc({ maxPlayers: 14 });
      jest.spyOn(service, 'create').mockResolvedValue(created);

      await service.createChallengeEvent(CHALLENGE_ID, ADMIN_A, {
        ...dto,
        maxPlayers: 14,
      });

      expect(created.maxPlayers).toBe(14);
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
      await expect(service.resubmitProposal(EVENT_ID, ADMIN_A)).rejects.toThrow(
        /still awaiting review/,
      );

      eventModel.findById.mockResolvedValue(
        eventDoc({ proposedStatus: 'accepted' }),
      );
      await expect(service.resubmitProposal(EVENT_ID, ADMIN_A)).rejects.toThrow(
        /already accepted/,
      );
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

    it('creates side-tagged INVITED rows — nobody counts until they accept', async () => {
      const res = await assign(ADMIN_A, [PLAYER_A]);

      const [row] = playerModel.create.mock.calls[0];
      expect(row.userId.toString()).toBe(PLAYER_A);
      expect(row.groupId.toString()).toBe(GROUP_A);
      // Assignment is an invitation, not a roster entry.
      expect(row.status).toBe('invited');

      // Nobody counts yet — the only event write is clearing the side's
      // ready flag, never a joinedCount bump.
      expect(eventModel.updateOne).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $inc: expect.anything() }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: PLAYER_A,
          title: 'Challenge match invitation',
        }),
      );
      expect(res).toMatchObject({ invited: [PLAYER_A], skipped: [] });
    });

    it('an already-invited or joined player is skipped, not an error', async () => {
      playerModel.findOne.mockResolvedValue({ status: 'invited' });

      const res = await assign(ADMIN_A, [PLAYER_A]);

      expect(res).toMatchObject({ invited: [], skipped: [PLAYER_A] });
      expect(playerModel.create).not.toHaveBeenCalled();
      expect(eventModel.updateOne).not.toHaveBeenCalled();
    });

    it('a declined player can be invited again, reason cleared', async () => {
      const row: any = {
        status: 'cancelled',
        inviteRejectReason: 'was injured',
        save: jest.fn().mockResolvedValue(undefined),
      };
      playerModel.findOne.mockResolvedValue(row);

      await assign(ADMIN_A, [PLAYER_A]);

      expect(row.status).toBe('invited');
      expect(row.inviteRejectReason).toBeNull();
      expect(row.save).toHaveBeenCalled();
    });
  });

  describe('respondInvitation — the player answers', () => {
    const invitedRow = () => ({
      status: 'invited',
      groupId: new Types.ObjectId(GROUP_A),
      inviteRejectReason: null,
      joinedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('404s without a pending invitation', async () => {
      playerModel.findOne.mockResolvedValue(null);
      await expect(
        service.respondInvitation(EVENT_ID, PLAYER_A, {
          action: 'accept',
        } as any),
      ).rejects.toThrow(/no pending invitation/);
    });

    it('accept joins the roster and bumps the count', async () => {
      const row = invitedRow();
      playerModel.findOne.mockResolvedValue(row);

      await service.respondInvitation(EVENT_ID, PLAYER_A, {
        action: 'accept',
      } as any);

      expect(row.status).toBe('joined');
      expect(row.joinedAt).toBeInstanceOf(Date);
      expect(eventModel.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { $inc: { joinedCount: 1 } },
      );
    });

    it("decline keeps the reason and tells the side's admins", async () => {
      const row = invitedRow();
      playerModel.findOne.mockResolvedValue(row);

      await service.respondInvitation(EVENT_ID, PLAYER_A, {
        action: 'reject',
        reason: 'Injured this week',
      } as any);

      expect(row.status).toBe('cancelled');
      expect(row.inviteRejectReason).toBe('Injured this week');
      expect(eventModel.updateOne).not.toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Invitation declined',
          body: expect.stringContaining('Injured this week'),
        }),
      );
    });

    it('rejects on a normal event — no invitations there', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ type: 'normal' }));
      await expect(
        service.respondInvitation(EVENT_ID, PLAYER_A, {
          action: 'accept',
        } as any),
      ).rejects.toThrow(/Only challenge events/);
    });
  });

  describe('resubmitProposal — with a date fix', () => {
    it('updates the date in the same call when provided', async () => {
      const doc = eventDoc({
        proposedStatus: 'rejected',
        proposalRejectReason: 'date change need',
        date: new Date('2026-10-20T13:00:00Z'),
      });
      eventModel.findById.mockResolvedValue(doc);

      await service.resubmitProposal(EVENT_ID, ADMIN_A, {
        date: '2026-10-27T13:00:00.000Z',
      } as any);

      expect(doc.date).toEqual(new Date('2026-10-27T13:00:00.000Z'));
      expect(doc.proposedStatus).toBe('proposed');
    });

    it('leaves the date alone when the body is empty', async () => {
      const original = new Date('2026-10-20T13:00:00Z');
      const doc = eventDoc({ proposedStatus: 'rejected', date: original });
      eventModel.findById.mockResolvedValue(doc);

      await service.resubmitProposal(EVENT_ID, ADMIN_A);

      expect(doc.date).toBe(original);
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
      // Challenge events build teams in ready_to_play — no preparation stage.
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'ready_to_play' }),
      );
      // The side-split reads the challenge through a select/lean chain.
      challengeModel.findById.mockReturnValue(
        chain({ challengerGroupId: new Types.ObjectId(GROUP_A) }),
      );
      const svc: any = service;
      jest
        .spyOn(svc, 'joinedPlayerIds')
        .mockResolvedValue([PLAYER_A, PLAYER_B]);
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
      // One caller fills BOTH sides' teams, so the shuffle skips the
      // caller-side check (it has already split players by side).
      expect(assignTeam).toHaveBeenCalledWith(
        EVENT_ID,
        't-red',
        ADMIN_A,
        expect.objectContaining({ playerIds: [PLAYER_A], guestIds: [] }),
        { skipCallerSideCheck: true },
      );
      expect(assignTeam).toHaveBeenCalledWith(
        EVENT_ID,
        't-white',
        ADMIN_A,
        expect.objectContaining({ playerIds: [PLAYER_B], guestIds: [] }),
        { skipCallerSideCheck: true },
      );
    });
  });

  describe('team generation is locked to two sides', () => {
    it('refuses any other teamsCount for a challenge event', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'ready_to_play' }),
      );
      await expect(
        service.generateTeams(EVENT_ID, ADMIN_A, {
          teamsCount: 4,
          numberOfPlayers: 5,
          duration: 15,
        } as any),
      ).rejects.toThrow(/exactly 2 teams/);
    });
  });

  describe('each side owns its own team', () => {
    const TEAM_B_ID = '507f1f77bcf86cd799439045';

    const teamBDoc = () => ({
      _id: new Types.ObjectId(TEAM_B_ID),
      eventId: new Types.ObjectId(EVENT_ID),
      groupId: new Types.ObjectId(GROUP_B),
      name: 'white',
      numberOfPlayers: 5,
      players: [],
      guests: [],
      playerRoles: [],
      save: jest.fn().mockResolvedValue(undefined),
      toJSON() {
        return { name: this.name, players: this.players };
      },
    });

    beforeEach(() => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'ready_to_play' }),
      );
      const svc: any = service;
      jest.spyOn(svc, 'matchProvidedFor').mockResolvedValue(undefined);
      jest
        .spyOn(svc, 'joinedPlayerIds')
        .mockResolvedValue([PLAYER_A, PLAYER_B]);
      teamModel.findOne = jest.fn().mockResolvedValue(teamBDoc());
      teamModel.find = jest.fn().mockReturnValue(chain([]));
      playerModel.updateMany = jest.fn().mockResolvedValue({});
      // Roster rows carry the side each player was assigned for.
      playerModel.find = jest.fn().mockReturnValue(
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
    });

    it("the opponent's admin fills their own team", async () => {
      const team = teamBDoc();
      teamModel.findOne.mockResolvedValue(team);

      await service.assignTeamPlayers(EVENT_ID, TEAM_B_ID, ADMIN_B, {
        playerIds: [PLAYER_B],
      });

      expect(team.save).toHaveBeenCalled();
      expect(team.players.map(String)).toEqual([PLAYER_B]);
    });

    it("refuses an admin editing the other group's team", async () => {
      await expect(
        service.assignTeamPlayers(EVENT_ID, TEAM_B_ID, ADMIN_A, {
          playerIds: [PLAYER_B],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a player assigned for the other side', async () => {
      await expect(
        service.assignTeamPlayers(EVENT_ID, TEAM_B_ID, ADMIN_B, {
          playerIds: [PLAYER_A],
        }),
      ).rejects.toThrow(/plays for the other group/);
    });

    it('the shuffle may fill either team, but never across sides', async () => {
      const team = teamBDoc();
      teamModel.findOne.mockResolvedValue(team);
      await service.assignTeamPlayers(
        EVENT_ID,
        TEAM_B_ID,
        ADMIN_A,
        { playerIds: [PLAYER_B] },
        { skipCallerSideCheck: true },
      );
      expect(team.save).toHaveBeenCalled();

      await expect(
        service.assignTeamPlayers(
          EVENT_ID,
          TEAM_B_ID,
          ADMIN_A,
          { playerIds: [PLAYER_A] },
          { skipCallerSideCheck: true },
        ),
      ).rejects.toThrow(/plays for the other group/);
    });

    it('generate stamps each team with its side, from the challenge', async () => {
      // Proposed by the CHALLENGED group: groupId is B, yet the first team
      // (challenger colour) must still belong to A.
      eventModel.findById.mockResolvedValue(
        eventDoc({
          status: 'ready_to_play',
          groupId: new Types.ObjectId(GROUP_B),
          opponentGroupId: new Types.ObjectId(GROUP_A),
          createdBy: new Types.ObjectId(ADMIN_B),
        }),
      );
      challengeModel.findById.mockReturnValue(chain(challengeDoc()));
      teamModel.deleteMany = jest.fn().mockResolvedValue({});
      teamModel.insertMany = jest
        .fn()
        .mockImplementation((docs: any[]) => Promise.resolve(docs));
      matchModel.deleteMany = jest.fn().mockResolvedValue({});
      matchModel.insertMany = jest.fn().mockResolvedValue([]);
      teamChatModel.updateOne = jest.fn().mockResolvedValue({});

      await service.generateTeams(EVENT_ID, ADMIN_B, {
        teamsCount: 2,
        numberOfPlayers: 5,
        duration: 15,
      } as any);

      const inserted = teamModel.insertMany.mock.calls[0][0];
      expect(inserted.map((t: any) => [t.name, String(t.groupId)])).toEqual([
        ['red', GROUP_A],
        ['white', GROUP_B],
      ]);
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
  describe('side readiness — both groups ready moves to ready_to_play', () => {
    const counts = (joined: number, invited: number) =>
      jest
        .fn()
        .mockImplementation((f: any) =>
          Promise.resolve(f.status === 'joined' ? joined : invited),
        );

    beforeEach(() => {
      playerModel.countDocuments = counts(3, 0);
      eventModel.findOneAndUpdate = jest.fn();
      playerModel.updateMany = jest.fn().mockResolvedValue({});
      teamModel.deleteMany = jest.fn().mockResolvedValue({});
    });

    it('rejects a normal event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ type: 'normal' }));
      await expect(service.setSideReady(EVENT_ID, ADMIN_A, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('blocks until the proposal is accepted', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ proposedStatus: 'proposed' }),
      );
      await expect(service.setSideReady(EVENT_ID, ADMIN_A, {})).rejects.toThrow(
        /not been accepted/,
      );
    });

    it('only while the event is in join', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'ready_to_play' }),
      );
      await expect(service.setSideReady(EVENT_ID, ADMIN_A, {})).rejects.toThrow(
        /only change while the event is in join/,
      );
    });

    it('403s a caller who runs neither side', async () => {
      await expect(
        service.setSideReady(EVENT_ID, STRANGER, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('needs at least one accepted player on the side', async () => {
      playerModel.countDocuments = counts(0, 0);
      await expect(service.setSideReady(EVENT_ID, ADMIN_B, {})).rejects.toThrow(
        /At least one/,
      );
    });

    it('withdraws unanswered invitations on the side and still marks ready', async () => {
      const rowIds = [new Types.ObjectId(), new Types.ObjectId()];
      playerModel.find = jest.fn().mockReturnValue(
        chain([
          { _id: rowIds[0], userId: new Types.ObjectId(PLAYER_B) },
          { _id: rowIds[1], userId: new Types.ObjectId(STRANGER) },
        ]),
      );
      eventModel.findOneAndUpdate.mockResolvedValueOnce(
        eventDoc({ opponentReadyAt: new Date(), hostReadyAt: null }),
      );

      const res = await service.setSideReady(EVENT_ID, ADMIN_B, {});

      expect(playerModel.find.mock.calls[0][0]).toMatchObject({
        groupId: new Types.ObjectId(GROUP_B),
        status: 'invited',
      });
      expect(playerModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: rowIds }, status: 'invited' },
        { $set: { status: 'cancelled' } },
      );
      expect(res).toMatchObject({
        ready: true,
        withdrawn: [PLAYER_B, STRANGER],
      });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: PLAYER_B,
          title: 'Invitation withdrawn',
        }),
      );
    });

    it('withdraws nothing when every invitation is answered', async () => {
      eventModel.findOneAndUpdate.mockResolvedValueOnce(
        eventDoc({ opponentReadyAt: new Date(), hostReadyAt: null }),
      );
      const res = await service.setSideReady(EVENT_ID, ADMIN_B, {});
      expect(playerModel.updateMany).not.toHaveBeenCalled();
      expect(res).toMatchObject({ withdrawn: [] });
    });

    it('first side ready: stamps its flag, waits, tells the other side', async () => {
      eventModel.findOneAndUpdate.mockResolvedValueOnce(
        eventDoc({ opponentReadyAt: new Date(), hostReadyAt: null }),
      );
      const shuffle = jest.spyOn(service, 'shuffleTeams');

      const res = await service.setSideReady(EVENT_ID, ADMIN_B, {});

      expect(eventModel.findOneAndUpdate.mock.calls[0][1].$set).toHaveProperty(
        'opponentReadyAt',
      );
      expect(res).toMatchObject({ ready: true, status: 'join' });
      expect(shuffle).not.toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Opponent is ready' }),
      );
    });

    it('second side ready: moves to ready_to_play and builds the side teams', async () => {
      const both = { hostReadyAt: new Date(), opponentReadyAt: new Date() };
      eventModel.findOneAndUpdate
        .mockResolvedValueOnce(eventDoc(both))
        .mockResolvedValueOnce(eventDoc({ ...both, status: 'ready_to_play' }));
      const shuffle = jest
        .spyOn(service, 'shuffleTeams')
        .mockResolvedValue({} as any);

      const res = await service.setSideReady(EVENT_ID, ADMIN_A, {});

      const [filter, update] = eventModel.findOneAndUpdate.mock.calls[1];
      expect(filter).toMatchObject({
        status: 'join',
        hostReadyAt: { $ne: null },
        opponentReadyAt: { $ne: null },
      });
      expect(update).toEqual({ $set: { status: 'ready_to_play' } });
      expect(shuffle).toHaveBeenCalledWith(EVENT_ID, ADMIN_A);
      expect(res).toMatchObject({ status: 'ready_to_play' });
    });

    it('a concurrent caller that loses the transition does not rebuild teams', async () => {
      const both = { hostReadyAt: new Date(), opponentReadyAt: new Date() };
      eventModel.findOneAndUpdate
        .mockResolvedValueOnce(eventDoc(both))
        .mockResolvedValueOnce(null);
      const shuffle = jest.spyOn(service, 'shuffleTeams');

      await service.setSideReady(EVENT_ID, ADMIN_A, {});
      expect(shuffle).not.toHaveBeenCalled();
    });

    it('ready: false clears only the caller side', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ hostReadyAt: new Date() }),
      );
      const res = await service.setSideReady(EVENT_ID, ADMIN_A, {
        ready: false,
      });
      expect(eventModel.updateOne).toHaveBeenCalledWith(expect.anything(), {
        $set: { hostReadyAt: null },
      });
      expect(res).toMatchObject({ ready: false });
    });

    it('groupId picks a side, but must be one of the two groups', async () => {
      await expect(
        service.setSideReady(EVENT_ID, ADMIN_A, {
          groupId: '507f1f77bcf86cd799439099',
        }),
      ).rejects.toThrow(/one of the two groups/);
      await expect(
        service.setSideReady(EVENT_ID, ADMIN_A, { groupId: GROUP_B }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('PATCH status join -> ready_to_play is refused for a challenge', async () => {
      jest.spyOn(service as any, 'matchProvidedFor').mockResolvedValue(true);
      await expect(
        service.setStatus(EVENT_ID, ADMIN_A, 'ready_to_play'),
      ).rejects.toThrow(/BOTH groups/);
    });

    it('reverting ready_to_play -> join clears both flags and the side teams', async () => {
      const ev = eventDoc({
        status: 'ready_to_play',
        hostReadyAt: new Date(),
        opponentReadyAt: new Date(),
        toJSON: () => ({}),
      });
      eventModel.findById.mockResolvedValue(ev);
      jest.spyOn(service as any, 'matchProvidedFor').mockResolvedValue(true);
      jest
        .spyOn(service as any, 'notifyRosterOfStatus')
        .mockResolvedValue(undefined);

      await service.setStatus(EVENT_ID, ADMIN_A, 'join');

      expect(ev.hostReadyAt).toBeNull();
      expect(ev.opponentReadyAt).toBeNull();
      expect(teamModel.deleteMany).toHaveBeenCalled();
    });

    it("inviting a player clears that side's ready flag", async () => {
      await service.assignPlayers(EVENT_ID, ADMIN_B, { userIds: [PLAYER_B] });
      expect(eventModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'join' }),
        { $set: { opponentReadyAt: null } },
      );
    });

    it('unassign is refused once the match is ready', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'ready_to_play' }),
      );
      await expect(
        service.unassignPlayer(EVENT_ID, ADMIN_A, PLAYER_A),
      ).rejects.toThrow(/frozen/);
    });
  });
});
