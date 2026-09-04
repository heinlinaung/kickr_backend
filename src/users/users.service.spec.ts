import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Event } from '../events/schemas/event.schema';
import { GlobalFootballTeam } from '../global-football-teams/schemas/global-football-team.schema';
import { ImageKitService } from '../common/upload/imagekit.service';

describe('UsersService', () => {
  let service: UsersService;

  const userModel: any = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const imagekit = {
    upload: jest.fn(),
    deleteFile: jest.fn(),
  };
  const playerModel: any = {};
  const eventModel: any = {};
  // Defaults to "the club exists" so the many tests that patch unrelated
  // profile fields are unaffected; the favouriteTeamId cases override it.
  const globalTeamModel: any = {
    exists: jest.fn().mockResolvedValue({ _id: 'stub' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: ImageKitService, useValue: imagekit },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(Event.name), useValue: eventModel },
        {
          provide: getModelToken(GlobalFootballTeam.name),
          useValue: globalTeamModel,
        },
      ],
    }).compile();
    service = m.get(UsersService);
  });

  describe('updateAvatar', () => {
    it('uploads the buffer, stores url + fileId, and deletes the previous image', async () => {
      userModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue({ _id: 'u1', profileImageFileId: 'oldFid' }),
        }),
      });
      imagekit.upload.mockResolvedValue({
        url: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
        fileId: 'newFid',
      });
      imagekit.deleteFile.mockResolvedValue(undefined);
      userModel.findByIdAndUpdate.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'u1',
            profileImage: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
            profileImageFileId: 'newFid',
          }),
        }),
      });

      const file = { buffer: Buffer.from('img') } as Express.Multer.File;
      const result = await service.updateAvatar('u1', file);

      expect(imagekit.upload).toHaveBeenCalledWith(
        file.buffer,
        expect.stringContaining('u1-'),
        'profiles',
      );
      expect(imagekit.deleteFile).toHaveBeenCalledWith('oldFid');
      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'u1',
        {
          $set: {
            profileImage: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
            profileImageFileId: 'newFid',
          },
        },
        { new: true },
      );
      expect(result.profileImage).toBe(
        'https://ik.imagekit.io/kickr/profiles/new.jpg',
      );
      expect(result.profileImageFileId).toBe('newFid');
    });

    it('does not call deleteFile when there is no previous image', async () => {
      userModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ _id: 'u1' }),
        }),
      });
      imagekit.upload.mockResolvedValue({
        url: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
        fileId: 'newFid',
      });
      userModel.findByIdAndUpdate.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'u1',
            profileImage: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
            profileImageFileId: 'newFid',
          }),
        }),
      });

      const file = { buffer: Buffer.from('img') } as Express.Multer.File;
      await service.updateAvatar('u1', file);

      expect(imagekit.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('getQr', () => {
    it('generates and persists an inviteCode when absent, returns a shareable payload', async () => {
      userModel.findById = jest
        .fn()
        .mockResolvedValue({ _id: 'u1', inviteCode: undefined });
      userModel.findByIdAndUpdate = jest
        .fn()
        .mockResolvedValue({ _id: 'u1', inviteCode: 'generated' });
      const res = await service.getQr('u1');
      // the persisted code must equal the returned code
      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith('u1', {
        $set: { inviteCode: res.inviteCode },
      });
      expect(res.inviteCode).toBeDefined();
      expect(res.inviteLink).toContain(res.inviteCode);
    });
    it('reuses an existing inviteCode', async () => {
      userModel.findById = jest
        .fn()
        .mockResolvedValue({ _id: 'u1', inviteCode: 'existing' });
      const res = await service.getQr('u1');
      expect(res.inviteCode).toBe('existing');
    });
  });

  describe('getPublicProfile', () => {
    it('hides email/phone and rejects private visibility', async () => {
      userModel.findById = jest.fn().mockReturnValue({
        select: () => ({
          lean: () =>
            Promise.resolve({
              _id: 'u2',
              name: 'Bob',
              email: 'bob@x.com',
              phoneNumber: '123',
              privacy: {
                profileVisibility: 'private',
                showStats: true,
                showMatchHistory: true,
              },
            }),
        }),
      });
      await expect(service.getPublicProfile('u2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
    it('returns filtered profile + stats + history for public users', async () => {
      userModel.findById = jest.fn().mockReturnValue({
        select: () => ({
          lean: () =>
            Promise.resolve({
              _id: 'u3',
              name: 'Cara',
              email: 'c@x.com',
              phoneNumber: '999',
              country: 'TH',
              privacy: {
                profileVisibility: 'public',
                showStats: true,
                showMatchHistory: true,
              },
            }),
        }),
      });
      playerModel.countDocuments = jest.fn().mockResolvedValue(2);
      playerModel.find = jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve([]) });
      const res = await service.getPublicProfile('u3');
      expect(res.email).toBeUndefined();
      expect(res.phoneNumber).toBeUndefined();
      expect(res.name).toBe('Cara');
      expect(res.statistics).toEqual(
        expect.objectContaining({
          matchesPlayed: 2,
          wins: 0,
          mvpCount: 0,
          avgRating: 0,
        }),
      );
      expect(Array.isArray(res.matchHistory)).toBe(true);
    });
    it('projects locationId and populates it instead of the removed flat fields', async () => {
      userModel.findById = jest.fn().mockReturnValue({
        select: () => ({
          lean: () =>
            Promise.resolve({
              _id: 'u5',
              name: 'Eve',
              privacy: {
                profileVisibility: 'public',
                showStats: true,
                showMatchHistory: true,
              },
            }),
        }),
      });
      playerModel.countDocuments = jest.fn().mockResolvedValue(1);
      playerModel.find = jest.fn().mockReturnValue({
        lean: () => Promise.resolve([{ eventId: 'e1' }]),
      });

      const history = [
        {
          _id: 'e1',
          title: 'Friday match',
          locationId: { _id: 'loc1', name: 'Lumpini', lat: 13.7, lng: 100.5 },
        },
      ];
      const lean = jest.fn().mockResolvedValue(history);
      const sort = jest.fn().mockReturnValue({ lean });
      const populate = jest.fn().mockReturnValue({ sort });
      const select = jest.fn().mockReturnValue({ populate });
      eventModel.find = jest.fn().mockReturnValue({ select });

      const res = await service.getPublicProfile('u5');

      expect(select).toHaveBeenCalledWith(
        'title date locationId sportType status',
      );
      expect(populate).toHaveBeenCalledWith('locationId', 'name lat lng');
      expect(sort).toHaveBeenCalledWith({ date: -1 });
      expect(res.matchHistory).toEqual(history);
    });
    it('omits stats and history when the privacy flags are off', async () => {
      userModel.findById = jest.fn().mockReturnValue({
        select: () => ({
          lean: () =>
            Promise.resolve({
              _id: 'u4',
              name: 'Dan',
              privacy: {
                profileVisibility: 'public',
                showStats: false,
                showMatchHistory: false,
              },
            }),
        }),
      });
      playerModel.countDocuments = jest.fn();
      playerModel.find = jest.fn();
      const res = await service.getPublicProfile('u4');
      expect(res.statistics).toBeUndefined();
      expect(res.matchHistory).toBeUndefined();
      // gated off → no EventPlayer queries at all
      expect(playerModel.countDocuments).not.toHaveBeenCalled();
      expect(playerModel.find).not.toHaveBeenCalled();
    });
  });
});
