import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TournamentsService } from './tournaments.service';
import { TournamentPhasesService } from './tournament-phases.service';
import { Tournament } from './schemas/tournament.schema';
import { TournamentTeam } from './schemas/tournament-team.schema';
import { TournamentMatch } from './schemas/tournament-match.schema';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';

/** A thenable query stub: chain methods return itself, await yields `value`. */
function q<T>(value: T): any {
  const chain: any = {
    select: () => chain,
    sort: jest.fn(() => chain),
    lean: () => chain,
    then: (res: any, rej: any) => Promise.resolve(value).then(res, rej),
  };
  return chain;
}

const DAY = 24 * 60 * 60 * 1000;

describe('TournamentsService — totalDays, listing and history', () => {
  let service: TournamentsService;
  const tournamentModel: any = {};
  const groupModel: any = {};
  const memberModel: any = {};
  const phases = { initFormat: jest.fn() };
  const GROUP_ID = new Types.ObjectId().toString();
  const USER = new Types.ObjectId().toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(tournamentModel, {
      create: jest.fn(async (doc: any) => ({
        _id: new Types.ObjectId(),
        ...doc,
      })),
      find: jest.fn(() => q([])),
    });
    Object.assign(groupModel, {
      findById: jest.fn(() => q({ _id: GROUP_ID, isPrivate: false })),
    });
    Object.assign(memberModel, { exists: jest.fn(), findOne: jest.fn() });

    const m = await Test.createTestingModule({
      providers: [
        TournamentsService,
        { provide: getModelToken(Tournament.name), useValue: tournamentModel },
        { provide: getModelToken(TournamentTeam.name), useValue: {} },
        { provide: getModelToken(TournamentMatch.name), useValue: {} },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: TournamentPhasesService, useValue: phases },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();
    service = m.get(TournamentsService);
  });

  describe('create', () => {
    it('sets endDate = startDate + totalDays', async () => {
      await service.create(USER, {
        title: 'Cup',
        maxTeams: 8,
        startDate: '2026-12-01T09:00:00.000Z',
        totalDays: 7,
      });
      const doc = tournamentModel.create.mock.calls[0][0];
      expect(doc.totalDays).toBe(7);
      expect(doc.endDate.toISOString()).toBe('2026-12-08T09:00:00.000Z');
    });

    it('counts from now without a startDate', async () => {
      const before = Date.now();
      await service.create(USER, { title: 'Cup', maxTeams: 8, totalDays: 3 });
      const doc = tournamentModel.create.mock.calls[0][0];
      expect(doc.endDate.getTime()).toBeGreaterThanOrEqual(before + 3 * DAY);
      expect(doc.endDate.getTime()).toBeLessThanOrEqual(Date.now() + 3 * DAY);
    });

    it('leaves endDate null without totalDays', async () => {
      await service.create(USER, { title: 'Cup', maxTeams: 8 });
      expect(tournamentModel.create.mock.calls[0][0].endDate).toBeNull();
    });

    it('sets registrationCloseAt = now + registerCloseDuration', async () => {
      const before = Date.now();
      await service.create(USER, {
        title: 'Cup',
        maxTeams: 8,
        startDate: new Date(Date.now() + 10 * DAY).toISOString(),
        totalDays: 7,
        registerCloseDuration: 3,
      });
      const doc = tournamentModel.create.mock.calls[0][0];
      expect(doc.registerCloseDuration).toBe(3);
      const at = doc.registrationCloseAt.getTime();
      expect(at).toBeGreaterThanOrEqual(before + 3 * DAY);
      expect(at).toBeLessThanOrEqual(Date.now() + 3 * DAY);
    });

    it('leaves registrationCloseAt null without registerCloseDuration', async () => {
      await service.create(USER, { title: 'Cup', maxTeams: 8 });
      expect(
        tournamentModel.create.mock.calls[0][0].registrationCloseAt,
      ).toBeNull();
    });

    it('rejects registration closing after the start date', async () => {
      await expect(
        service.create(USER, {
          title: 'Cup',
          maxTeams: 8,
          startDate: new Date(Date.now() + 2 * DAY).toISOString(),
          registerCloseDuration: 3,
        }),
      ).rejects.toThrow(/start date/);
      expect(tournamentModel.create).not.toHaveBeenCalled();
    });

    it('rejects registration closing after the tournament ends', async () => {
      await expect(
        service.create(USER, {
          title: 'Cup',
          maxTeams: 8,
          totalDays: 2,
          registerCloseDuration: 3,
        }),
      ).rejects.toThrow(/ends/);
    });
  });

  describe('registerTeam', () => {
    it('only takes teams before the registration deadline', async () => {
      tournamentModel.findOneAndUpdate = jest.fn().mockResolvedValue(null);
      tournamentModel.findById = jest.fn(() =>
        q({
          status: 'REGISTRATION_OPEN',
          registrationCloseAt: new Date(Date.now() - DAY),
          currentTeams: 0,
          maxTeams: 8,
        }),
      );
      await expect(
        service.registerTeam(new Types.ObjectId().toString(), USER, {
          name: 'A',
          players: [],
        } as any),
      ).rejects.toThrow(/not accepting registrations/);
      const [filter] = tournamentModel.findOneAndUpdate.mock.calls[0];
      expect(filter.$or).toEqual([
        { registrationCloseAt: null },
        { registrationCloseAt: { $gt: expect.any(Date) } },
      ]);
    });
  });

  describe('listByGroup', () => {
    it('excludes finished and expired tournaments', async () => {
      await service.listByGroup(GROUP_ID, USER);
      const [filter] = tournamentModel.find.mock.calls[0];
      const [base, scope] = filter.$and;
      expect(base.groupId.toString()).toBe(GROUP_ID);
      expect(scope.status).toEqual({ $nin: ['COMPLETED', 'CANCELLED'] });
      expect(scope.$or).toEqual([
        { endDate: null },
        { endDate: { $gt: expect.any(Date) } },
      ]);
    });

    it('keeps the caller status filter alongside the scope', async () => {
      await service.listByGroup(GROUP_ID, USER, 'REGISTRATION_OPEN');
      const [base] = tournamentModel.find.mock.calls[0][0].$and;
      expect(base.status).toBe('REGISTRATION_OPEN');
    });
  });

  describe('listGroupHistory', () => {
    it('returns finished or expired tournaments', async () => {
      await service.listGroupHistory(GROUP_ID, USER);
      const [, scope] = tournamentModel.find.mock.calls[0][0].$and;
      expect(scope.$or).toEqual([
        { status: { $in: ['COMPLETED', 'CANCELLED'] } },
        { endDate: { $lte: expect.any(Date) } },
      ]);
    });

    it('rejects an unknown status', async () => {
      await expect(
        service.listGroupHistory(GROUP_ID, USER, 'NOPE'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks non-members of a private group', async () => {
      groupModel.findById.mockReturnValue(
        q({ _id: GROUP_ID, isPrivate: true }),
      );
      memberModel.exists.mockResolvedValue(null);
      await expect(service.listGroupHistory(GROUP_ID, USER)).rejects.toThrow(
        /private/,
      );
    });
  });
});
