// src/users/users.favourite-team.spec.ts
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Event } from '../events/schemas/event.schema';
import { GlobalFootballTeam } from '../global-football-teams/schemas/global-football-team.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import { ConfigService } from '@nestjs/config';

const USER = '507f191e810c19729de860e1';
const TEAM = '68b9c1aa22bb33cc44dd0003';

describe('UsersService — favourite team', () => {
  let service: UsersService;
  const userModel: any = {};
  const globalTeamModel: any = {};
  const query: any = {};

  /** The chain findById() uses: .select().populate().lean() */
  const userChain = (result: any) => {
    query.select = jest.fn().mockReturnThis();
    query.populate = jest.fn().mockReturnThis();
    query.lean = jest.fn().mockResolvedValue(result);
    return query;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    userModel.findById = jest.fn().mockReturnValue(userChain({ _id: USER }));
    userModel.findOne = jest.fn().mockResolvedValue(null);
    userModel.findByIdAndUpdate = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: USER }),
    });
    globalTeamModel.exists = jest.fn().mockResolvedValue({ _id: TEAM });

    const m = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(EventPlayer.name), useValue: {} },
        { provide: getModelToken(Event.name), useValue: {} },
        {
          provide: getModelToken(GlobalFootballTeam.name),
          useValue: globalTeamModel,
        },
        { provide: ImageKitService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();
    service = m.get(UsersService);
  });

  describe('GET /users/me — the lookup', () => {
    it('projects the joined club as `favouriteTeam`', async () => {
      const teamObjectId = new Types.ObjectId(TEAM);
      userModel.findById.mockReturnValue(
        userChain({
          _id: USER,
          name: 'Hein',
          // populate() replaces the value IN PLACE, so the raw field arrives
          // holding the club document.
          favouriteTeamId: {
            _id: teamObjectId,
            name: 'Arsenal',
            sortOrder: 3,
          },
        }),
      );

      const res: any = await service.findById(USER);

      expect(res.favouriteTeam).toEqual({
        _id: teamObjectId,
        name: 'Arsenal',
        sortOrder: 3,
      });
    });

    it('leaves `favouriteTeamId` as the bare id, not the object', async () => {
      // The whole point of the rename: a client must not have to read a club
      // object out of a field named `...Id`.
      const teamObjectId = new Types.ObjectId(TEAM);
      userModel.findById.mockReturnValue(
        userChain({
          _id: USER,
          favouriteTeamId: { _id: teamObjectId, name: 'Arsenal' },
        }),
      );

      const res: any = await service.findById(USER);

      expect(res.favouriteTeamId).toBe(teamObjectId);
      expect(res.favouriteTeamId).not.toHaveProperty('name');
    });

    it('populates only name and sortOrder', async () => {
      // The rest of the club document is timestamps and __v.
      await service.findById(USER);

      expect(query.populate).toHaveBeenCalledWith(
        'favouriteTeamId',
        'name sortOrder',
      );
    });

    it('reports null when the user has no club set', async () => {
      userModel.findById.mockReturnValue(
        userChain({ _id: USER, favouriteTeamId: null }),
      );

      const res: any = await service.findById(USER);

      expect(res.favouriteTeam).toBeNull();
      expect(res.favouriteTeamId).toBeNull();
    });

    it('reports null when the field is absent entirely', async () => {
      // Legacy rows written before the field existed have no key at all —
      // Mongoose defaults apply on WRITE, not on read.
      userModel.findById.mockReturnValue(userChain({ _id: USER }));

      const res: any = await service.findById(USER);

      expect(res.favouriteTeam).toBeNull();
    });

    it('survives a dangling reference to a deleted club', async () => {
      // populate() yields null when the target row is gone. /users/me is on
      // the critical path for every session, so this must not throw.
      userModel.findById.mockReturnValue(
        userChain({ _id: USER, favouriteTeamId: null }),
      );

      await expect(service.findById(USER)).resolves.toBeDefined();
    });

    it('still excludes devices — the sensitive projection is unchanged', async () => {
      // Adding a populate must not have displaced the .select() that keeps
      // FCM tokens off the wire.
      await service.findById(USER);

      expect(query.select).toHaveBeenCalledWith('-__v -devices');
    });
  });

  describe('PATCH /users/me — the write', () => {
    it('accepts a club that exists', async () => {
      await expect(
        service.updateProfile(USER, { favouriteTeamId: TEAM } as any),
      ).resolves.toBeDefined();

      expect(globalTeamModel.exists).toHaveBeenCalledWith({ _id: TEAM });
    });

    it('rejects an unknown club with 400', async () => {
      // @IsMongoId only proves the SHAPE. Without this check an unknown id
      // saves fine and then reads back as favouriteTeam: null forever —
      // indistinguishable from "not set".
      globalTeamModel.exists.mockResolvedValue(null);

      await expect(
        service.updateProfile(USER, { favouriteTeamId: TEAM } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('allows null to clear the club, with no lookup', async () => {
      await expect(
        service.updateProfile(USER, { favouriteTeamId: null } as any),
      ).resolves.toBeDefined();

      // Nothing to verify the existence of when clearing.
      expect(globalTeamModel.exists).not.toHaveBeenCalled();
    });

    it('does not look up the club when the field is absent', async () => {
      // An unrelated profile edit must not pay for a club query.
      await service.updateProfile(USER, { name: 'Hein' } as any);

      expect(globalTeamModel.exists).not.toHaveBeenCalled();
    });

    it('persists the id it was given', async () => {
      await service.updateProfile(USER, { favouriteTeamId: TEAM } as any);

      const [, update] = userModel.findByIdAndUpdate.mock.calls[0];
      expect(update.$set.favouriteTeamId).toBe(TEAM);
    });
  });
});
