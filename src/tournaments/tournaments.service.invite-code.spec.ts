import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
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
    lean: () => chain,
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

describe('TournamentsService — QR / share link', () => {
  let service: TournamentsService;
  const tournamentModel: any = {};
  const groupModel: any = {};
  const T_ID = new Types.ObjectId();
  const USER = new Types.ObjectId().toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(tournamentModel, {
      findById: jest.fn(() => q({ _id: T_ID })),
      findOne: jest.fn(() => q(null)),
      findOneAndUpdate: jest.fn(async (_f: any, u: any) => ({
        inviteCode: u.$set.inviteCode,
      })),
    });
    Object.assign(groupModel, { findById: jest.fn(() => q(null)) });

    const m = await Test.createTestingModule({
      providers: [
        TournamentsService,
        { provide: getModelToken(Tournament.name), useValue: tournamentModel },
        { provide: getModelToken(TournamentTeam.name), useValue: {} },
        { provide: getModelToken(TournamentMatch.name), useValue: {} },
        { provide: getModelToken(GroupMember.name), useValue: {} },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: TournamentPhasesService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://kickr.app' },
        },
      ],
    }).compile();
    service = m.get(TournamentsService);
  });

  describe('getQr', () => {
    it('reuses an existing code', async () => {
      tournamentModel.findById.mockReturnValue(
        q({ _id: T_ID, inviteCode: 'K7QM4XPA' }),
      );
      const qr = await service.getQr(T_ID.toString());
      expect(qr).toEqual({
        inviteCode: 'K7QM4XPA',
        inviteLink: 'https://kickr.app/t/K7QM4XPA',
        deepLink: `kickrsport://tournament/${T_ID}`,
        tournamentId: T_ID.toString(),
      });
      expect(tournamentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('mints an 8-character code the first time', async () => {
      const qr = await service.getQr(T_ID.toString());
      expect(qr.inviteCode).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
      expect(tournamentModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: T_ID, inviteCode: { $exists: false } },
        expect.anything(),
        expect.anything(),
      );
    });

    it('keeps the code a concurrent first fetch already set', async () => {
      tournamentModel.findOneAndUpdate.mockResolvedValue(null);
      tournamentModel.findById
        .mockReturnValueOnce(q({ _id: T_ID }))
        .mockReturnValueOnce(q({ _id: T_ID, inviteCode: 'WINNER22' }));
      expect((await service.getQr(T_ID.toString())).inviteCode).toBe(
        'WINNER22',
      );
    });

    it('retries when the code collides with another tournament', async () => {
      tournamentModel.findOneAndUpdate
        .mockRejectedValueOnce({ code: 11000 })
        .mockResolvedValueOnce({ inviteCode: 'SECOND22' });
      expect((await service.getQr(T_ID.toString())).inviteCode).toBe(
        'SECOND22',
      );
    });

    it('404s for an unknown tournament', async () => {
      tournamentModel.findById.mockReturnValue(q(null));
      expect(await codeOf(service.getQr(T_ID.toString()))).toBe(
        'TOURNAMENT_NOT_FOUND',
      );
      expect(await codeOf(service.getQr('nope'))).toBe('TOURNAMENT_NOT_FOUND');
    });
  });

  describe('resolveInviteCode', () => {
    it('matches case-insensitively and reports whether it is open', async () => {
      tournamentModel.findOne.mockReturnValue(
        q({
          _id: T_ID,
          title: 'Summer Cup',
          status: 'REGISTRATION_OPEN',
          maxTeams: 8,
          currentTeams: 8,
          groupId: null,
        }),
      );
      const t = await service.resolveInviteCode(' k7qm4xpa ');
      expect(tournamentModel.findOne).toHaveBeenCalledWith({
        inviteCode: 'K7QM4XPA',
      });
      expect(t).toMatchObject({ title: 'Summer Cup', registrationOpen: false });
    });

    it('is null for junk without querying', async () => {
      expect(await service.resolveInviteCode('<script>')).toBeNull();
      expect(tournamentModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe('joinByCode', () => {
    const dto = { code: 'k7qm4xpa', name: 'Team Alpha', players: [USER] };

    it('registers the team in the tournament behind the code', async () => {
      tournamentModel.findOne.mockReturnValue(q({ _id: T_ID }));
      const register = jest
        .spyOn(service, 'registerTeam')
        .mockResolvedValue({ _id: 'team' } as any);
      await service.joinByCode(USER, dto);
      expect(register).toHaveBeenCalledWith(T_ID.toString(), USER, {
        name: 'Team Alpha',
        players: [USER],
      });
    });

    it('rejects an unknown code', async () => {
      expect(await codeOf(service.joinByCode(USER, dto))).toBe(
        'INVALID_INVITE_CODE',
      );
    });
  });
});
