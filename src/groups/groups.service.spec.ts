import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { GroupsService } from './groups.service';
import { Group } from './schemas/group.schema';
import { GroupMember } from './schemas/group-member.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import { LocationsService } from '../locations/locations.service';

/** thin chainable mongoose query stub */
const q = (result: any) => ({
  select: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});

describe('GroupsService', () => {
  let service: GroupsService;

  const groupModel: any = {};
  const memberModel: any = {};
  const imagekit: any = {};
  const locationsService: any = {};

  const GROUP_ID = new Types.ObjectId().toString();
  const USER_ID = new Types.ObjectId().toString();
  const LOC_ID = new Types.ObjectId().toString();
  const TARGET_ID = new Types.ObjectId().toString();

  /** makes assertOwnerOrAdmin pass */
  const allowOwner = () =>
    memberModel.findOne.mockResolvedValue({ role: 'owner' });

  const file = (name = 'pic.png') =>
    ({
      buffer: Buffer.from('image-bytes'),
      originalname: name,
    }) as unknown as Express.Multer.File;

  beforeEach(async () => {
    jest.clearAllMocks();

    Object.assign(groupModel, {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
    });
    Object.assign(memberModel, {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
    });
    Object.assign(imagekit, {
      upload: jest.fn().mockResolvedValue({
        url: 'https://ik.imagekit.io/kickr/groups/new.png',
        fileId: 'new-file-id',
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    });
    Object.assign(locationsService, {
      create: jest.fn(),
      assertOwnedBy: jest.fn().mockResolvedValue({ _id: LOC_ID }),
      remove: jest.fn(),
    });

    const m = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: ImageKitService, useValue: imagekit },
        { provide: LocationsService, useValue: locationsService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
      ],
    }).compile();

    service = m.get(GroupsService);
  });

  // ---------------------------------------------------------------- TASK 6
  describe('updateLogo', () => {
    it('is owner/admin gated', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.updateLogo(GROUP_ID, USER_ID, file()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(imagekit.upload).not.toHaveBeenCalled();
    });

    it('uploads the buffer to the groups folder, deletes the prior logoFileId and stores the new url + fileId', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({ logoFileId: 'old-logo-id' }));
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({
          _id: GROUP_ID,
          logo: 'https://ik.imagekit.io/kickr/groups/new.png',
          logoFileId: 'new-file-id',
        }),
      );

      const res: any = await service.updateLogo(GROUP_ID, USER_ID, file());

      expect(imagekit.upload).toHaveBeenCalledTimes(1);
      const [buf, , folder] = imagekit.upload.mock.calls[0];
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.toString()).toBe('image-bytes');
      expect(folder).toBe('groups');
      expect(imagekit.deleteFile).toHaveBeenCalledWith('old-logo-id');

      const patch = groupModel.findByIdAndUpdate.mock.calls[0][1];
      expect(patch.$set.logo).toBe('https://ik.imagekit.io/kickr/groups/new.png');
      expect(patch.$set.logoFileId).toBe('new-file-id');
      expect(res.logo).toBe('https://ik.imagekit.io/kickr/groups/new.png');
    });

    it('does not call deleteFile when there is no prior logo', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({}));
      groupModel.findByIdAndUpdate.mockReturnValue(q({ _id: GROUP_ID }));

      await service.updateLogo(GROUP_ID, USER_ID, file());

      expect(imagekit.deleteFile).not.toHaveBeenCalled();
    });

    it('still updates the logo when deleting the prior file fails', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({ logoFileId: 'old-logo-id' }));
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({ _id: GROUP_ID, logo: 'https://ik.imagekit.io/kickr/groups/new.png' }),
      );
      imagekit.deleteFile.mockRejectedValue(new Error('imagekit down'));

      const res: any = await service.updateLogo(GROUP_ID, USER_ID, file());

      expect(res.logo).toBe('https://ik.imagekit.io/kickr/groups/new.png');
    });

    it('404s when the group is missing', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q(null));
      await expect(
        service.updateLogo(GROUP_ID, USER_ID, file()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateWallpaper', () => {
    it('stores the ImageKit url, never a local /uploads/groups path', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({ wallpaperFileId: 'old-wp-id' }));
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({
          _id: GROUP_ID,
          wallpaper: 'https://ik.imagekit.io/kickr/groups/new.png',
          wallpaperFileId: 'new-file-id',
        }),
      );

      const res: any = await service.updateWallpaper(
        GROUP_ID,
        USER_ID,
        file('wp.png'),
      );

      const patch = groupModel.findByIdAndUpdate.mock.calls[0][1];
      expect(patch.$set.wallpaper).toBe(
        'https://ik.imagekit.io/kickr/groups/new.png',
      );
      expect(patch.$set.wallpaper).not.toContain('/uploads/');
      expect(patch.$set.wallpaperFileId).toBe('new-file-id');
      expect(imagekit.upload.mock.calls[0][2]).toBe('groups');
      expect(imagekit.deleteFile).toHaveBeenCalledWith('old-wp-id');
      expect(res.wallpaper).toBe('https://ik.imagekit.io/kickr/groups/new.png');
    });

    it('is owner/admin gated', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.updateWallpaper(GROUP_ID, USER_ID, file()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(imagekit.upload).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('only returns public groups and matches name OR handle', async () => {
      groupModel.find.mockReturnValue(q([{ _id: GROUP_ID, name: 'Bangkok FC' }]));

      await service.search('bangkok');

      const filter = groupModel.find.mock.calls[0][0];
      expect(filter.isPrivate).toBe(false);
      expect(filter.$or).toHaveLength(2);
      const fields = filter.$or.map((c: any) => Object.keys(c)[0]);
      expect(fields).toEqual(expect.arrayContaining(['name', 'handle']));
      for (const clause of filter.$or) {
        const rx = Object.values(clause)[0] as RegExp;
        expect(rx).toBeInstanceOf(RegExp);
        expect(rx.flags).toContain('i');
        expect(rx.test('Bangkok FC')).toBe(true);
      }
    });

    it('escapes regex special characters instead of throwing', async () => {
      groupModel.find.mockReturnValue(q([]));

      await expect(service.search('a+b')).resolves.toEqual([]);

      const filter = groupModel.find.mock.calls[0][0];
      const rx = Object.values(filter.$or[0])[0] as RegExp;
      // escaped: matches the literal 'a+b', not 'aab'
      expect(rx.test('a+b')).toBe(true);
      expect(rx.test('aab')).toBe(false);
    });

    it('limits the result set', async () => {
      const query = q([]);
      groupModel.find.mockReturnValue(query);
      await service.search('x');
      expect(query.limit).toHaveBeenCalledWith(20);
    });
  });

  describe('setRules', () => {
    it('is owner/admin gated', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.setRules(GROUP_ID, USER_ID, ['a']),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects more than 3 rules', async () => {
      allowOwner();
      await expect(
        service.setRules(GROUP_ID, USER_ID, ['a', 'b', 'c', 'd']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('persists teamRules', async () => {
      allowOwner();
      const rules = ['Be on time', 'No slide tackles'];
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({ _id: GROUP_ID, teamRules: rules }),
      );

      const res: any = await service.setRules(GROUP_ID, USER_ID, rules);

      expect(groupModel.findByIdAndUpdate.mock.calls[0][1]).toEqual({
        $set: { teamRules: rules },
      });
      expect(res.teamRules).toEqual(rules);
    });

    it('404s when the group is missing', async () => {
      allowOwner();
      groupModel.findByIdAndUpdate.mockReturnValue(q(null));
      await expect(
        service.setRules(GROUP_ID, USER_ID, ['a']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getRules', () => {
    it('returns the rules array', async () => {
      groupModel.findById.mockReturnValue(
        q({ _id: GROUP_ID, teamRules: ['Be on time'] }),
      );
      await expect(service.getRules(GROUP_ID)).resolves.toEqual({
        rules: ['Be on time'],
      });
    });

    it('defaults to an empty array when teamRules is unset', async () => {
      groupModel.findById.mockReturnValue(q({ _id: GROUP_ID }));
      await expect(service.getRules(GROUP_ID)).resolves.toEqual({ rules: [] });
    });

    it('404s when the group is missing', async () => {
      groupModel.findById.mockReturnValue(q(null));
      await expect(service.getRules(GROUP_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getQr', () => {
    it('is owner/admin gated', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(service.getQr(GROUP_ID, USER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns the invite code and a link containing it', async () => {
      allowOwner();
      groupModel.findByIdAndUpdate.mockResolvedValue({ _id: GROUP_ID });

      const res = await service.getQr(GROUP_ID, USER_ID);

      expect(res.inviteCode).toBeTruthy();
      expect(res.inviteLink).toContain(res.inviteCode);
      expect(res.inviteLink).toBe(
        `http://localhost:3000/g/${res.inviteCode}`,
      );
    });
  });
});
