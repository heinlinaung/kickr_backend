import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, HttpException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TournamentInvitationsService } from './tournament-invitations.service';
import { TournamentsService } from './tournaments.service';
import { Tournament } from './schemas/tournament.schema';
import { TournamentTeam } from './schemas/tournament-team.schema';
import { TournamentInvitation } from './schemas/tournament-invitation.schema';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { NotificationsService } from '../notifications/notifications.service';

/** A thenable query stub: chain methods return itself, await yields `value`. */
function q<T>(value: T): any {
  const chain: any = {
    select: () => chain,
    lean: () => chain,
    sort: () => chain,
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

describe('TournamentInvitationsService', () => {
  let service: TournamentInvitationsService;

  const invitationModel: any = {};
  const tournamentModel: any = {};
  const teamModel: any = {};
  const groupModel: any = {};
  const memberModel: any = {};
  const tournamentsService: any = {};
  const notifications: any = {};

  const ORGANIZER = new Types.ObjectId();
  const ADMIN = new Types.ObjectId();
  const T_ID = new Types.ObjectId();
  const G1 = new Types.ObjectId();
  const G2 = new Types.ObjectId();
  const INV_ID = new Types.ObjectId();

  const tournament = (over: Record<string, unknown> = {}) => ({
    _id: T_ID,
    title: 'Summer Cup',
    createdBy: ORGANIZER,
    status: 'REGISTRATION_OPEN',
    maxTeams: 8,
    currentTeams: 2,
    ...over,
  });
  const invitation = (over: Record<string, unknown> = {}) => ({
    _id: INV_ID,
    tournamentId: T_ID,
    groupId: G1,
    invitedBy: ORGANIZER,
    status: 'PENDING',
    ...over,
  });
  const teamDto = { name: 'Team Alpha', players: [ADMIN.toString()] };

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(invitationModel, {
      findById: jest.fn(() => q(invitation())),
      find: jest.fn(() => q([])),
      findOneAndUpdate: jest.fn(async () => ({ _id: INV_ID })),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
      distinct: jest.fn().mockResolvedValue([]),
      create: jest.fn(async (doc) => ({ _id: new Types.ObjectId(), ...doc })),
    });
    Object.assign(tournamentModel, {
      findById: jest.fn(() => q(tournament())),
      find: jest.fn(() => q([])),
      distinct: jest.fn().mockResolvedValue([]),
    });
    Object.assign(teamModel, {
      distinct: jest.fn().mockResolvedValue([]),
      exists: jest.fn().mockResolvedValue(null),
    });
    Object.assign(groupModel, {
      find: jest.fn(() => q([{ _id: G1 }, { _id: G2 }])),
      findById: jest.fn(() => q({ name: 'Lions FC' })),
      exists: jest.fn().mockResolvedValue({ _id: G1 }),
    });
    Object.assign(memberModel, {
      exists: jest.fn().mockResolvedValue({ _id: 'admin-row' }),
      distinct: jest.fn().mockResolvedValue([ADMIN]),
    });
    Object.assign(tournamentsService, {
      registerTeam: jest.fn(async () => ({ _id: new Types.ObjectId() })),
    });
    Object.assign(notifications, { notifyUsers: jest.fn() });

    const m = await Test.createTestingModule({
      providers: [
        TournamentInvitationsService,
        {
          provide: getModelToken(TournamentInvitation.name),
          useValue: invitationModel,
        },
        { provide: getModelToken(Tournament.name), useValue: tournamentModel },
        { provide: getModelToken(TournamentTeam.name), useValue: teamModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: TournamentsService, useValue: tournamentsService },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = m.get(TournamentInvitationsService);
  });

  describe('invite', () => {
    const invite = (groupIds: string[], caller = ORGANIZER) =>
      service.invite(caller.toString(), T_ID.toString(), { groupIds });

    it('only the organizer can invite', async () => {
      expect(await codeOf(invite([G1.toString()], ADMIN))).toBe(
        'NOT_ORGANIZER',
      );
    });

    it('refuses once registration is past', async () => {
      tournamentModel.findById.mockReturnValue(
        q(tournament({ status: 'LEAGUE_IN_PROGRESS' })),
      );
      expect(await codeOf(invite([G1.toString()]))).toBe('TOURNAMENT_CLOSED');
    });

    it('reports each group on its own and notifies the invited admins', async () => {
      const missing = new Types.ObjectId().toString();
      invitationModel.distinct.mockResolvedValue([G2]);
      const { results } = await invite([G1.toString(), G2.toString(), missing]);

      expect(results).toEqual([
        expect.objectContaining({ groupId: G1.toString(), status: 'INVITED' }),
        {
          groupId: G2.toString(),
          status: 'FAILED',
          error: { code: 'INVITATION_EXISTS' },
        },
        {
          groupId: missing,
          status: 'FAILED',
          error: { code: 'GROUP_NOT_FOUND' },
        },
      ]);
      expect(invitationModel.create).toHaveBeenCalledTimes(1);
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        [ADMIN.toString()],
        expect.objectContaining({ type: 'tournament', refId: T_ID.toString() }),
      );
    });

    it('flags a group that already has a team in', async () => {
      teamModel.distinct.mockResolvedValue([G1]);
      const { results } = await invite([G1.toString()]);
      expect(results[0]).toMatchObject({
        error: { code: 'ALREADY_REGISTERED' },
      });
      expect(notifications.notifyUsers).not.toHaveBeenCalled();
    });

    it('flags every group when the tournament is full', async () => {
      tournamentModel.findById.mockReturnValue(
        q(tournament({ currentTeams: 8 })),
      );
      const { results } = await invite([G1.toString()]);
      expect(results[0]).toMatchObject({ error: { code: 'TOURNAMENT_FULL' } });
    });

    it('turns a lost duplicate-key race into INVITATION_EXISTS', async () => {
      invitationModel.create.mockRejectedValue({ code: 11000 });
      const { results } = await invite([G1.toString()]);
      expect(results[0]).toMatchObject({
        error: { code: 'INVITATION_EXISTS' },
      });
    });
  });

  describe('accept', () => {
    const accept = () =>
      service.accept(ADMIN.toString(), INV_ID.toString(), teamDto);

    it('registers the team with clubId = the invited group', async () => {
      const res = await accept();
      expect(tournamentsService.registerTeam).toHaveBeenCalledWith(
        T_ID.toString(),
        ADMIN.toString(),
        { ...teamDto, clubId: G1.toString() },
      );
      expect(res.status).toBe('ACCEPTED');
      expect(invitationModel.updateOne).toHaveBeenCalledWith(
        { _id: INV_ID },
        { $set: { teamId: res.team._id } },
      );
    });

    it('reads as not found for someone who does not run the group', async () => {
      memberModel.exists.mockResolvedValue(null);
      expect(await codeOf(accept())).toBe('INVITATION_NOT_FOUND');
    });

    it('refuses an answered invitation', async () => {
      invitationModel.findById.mockReturnValue(
        q(invitation({ status: 'DECLINED' })),
      );
      expect(await codeOf(accept())).toBe('INVITATION_NOT_PENDING');
    });

    it('expires the invitation once a phase has started', async () => {
      tournamentModel.findById.mockReturnValue(
        q(tournament({ status: 'KNOCKOUT_IN_PROGRESS' })),
      );
      expect(await codeOf(accept())).toBe('TOURNAMENT_CLOSED');
      expect(invitationModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: INV_ID, status: 'PENDING' },
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'EXPIRED' }),
        }),
        { new: true },
      );
    });

    it('keeps it pending while registration is closed but can reopen', async () => {
      tournamentModel.findById.mockReturnValue(
        q(tournament({ status: 'REGISTRATION_CLOSED' })),
      );
      expect(await codeOf(accept())).toBe('TOURNAMENT_CLOSED');
      expect(invitationModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses when the group already has a team in', async () => {
      teamModel.exists.mockResolvedValue({ _id: 'team' });
      expect(await codeOf(accept())).toBe('ALREADY_REGISTERED');
    });

    it('loses a race to another admin', async () => {
      invitationModel.findOneAndUpdate.mockResolvedValue(null);
      expect(await codeOf(accept())).toBe('INVITATION_NOT_PENDING');
      expect(tournamentsService.registerTeam).not.toHaveBeenCalled();
    });

    it('hands the claim back when registration fails', async () => {
      tournamentsService.registerTeam.mockRejectedValue(
        new BadRequestException('Tournament is full'),
      );
      await expect(accept()).rejects.toBeInstanceOf(BadRequestException);
      expect(invitationModel.updateOne).toHaveBeenCalledWith(
        { _id: INV_ID, status: 'ACCEPTED' },
        { $set: { status: 'PENDING', respondedAt: null, respondedBy: null } },
      );
    });
  });

  describe('decline', () => {
    it('declines and tells the organizer', async () => {
      const res = await service.decline(ADMIN.toString(), INV_ID.toString());
      expect(res).toEqual({ id: INV_ID.toString(), status: 'DECLINED' });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        [ORGANIZER.toString()],
        expect.objectContaining({
          body: 'Lions FC declined your tournament invitation',
        }),
      );
    });
  });

  describe('revoke', () => {
    it('only the organizer can revoke', async () => {
      expect(
        await codeOf(service.revoke(ADMIN.toString(), INV_ID.toString())),
      ).toBe('NOT_ORGANIZER');
    });

    it('refuses an answered invitation', async () => {
      invitationModel.findOneAndUpdate.mockResolvedValue(null);
      expect(
        await codeOf(service.revoke(ORGANIZER.toString(), INV_ID.toString())),
      ).toBe('INVITATION_NOT_PENDING');
    });
  });

  describe('listReceived', () => {
    it('is for the group owner/admin only', async () => {
      memberModel.exists.mockResolvedValue(null);
      expect(
        await codeOf(
          service.listReceived(ADMIN.toString(), G1.toString(), 'pending'),
        ),
      ).toBe('NOT_GROUP_ADMIN');
    });

    it('expires pending invitations to tournaments that started', async () => {
      const started = new Types.ObjectId();
      invitationModel.distinct.mockResolvedValue([T_ID, started]);
      tournamentModel.distinct.mockResolvedValue([T_ID]);
      await service.listReceived(ADMIN.toString(), G1.toString(), 'pending');
      expect(invitationModel.updateMany).toHaveBeenCalledWith(
        { groupId: G1, status: 'PENDING', tournamentId: { $in: [started] } },
        expect.anything(),
      );
    });
  });
});
