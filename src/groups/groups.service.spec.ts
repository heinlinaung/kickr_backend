import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
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
      adoptPersonalLocations: jest.fn().mockResolvedValue(undefined),
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
      expect(patch.$set.logo).toBe(
        'https://ik.imagekit.io/kickr/groups/new.png',
      );
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
        q({
          _id: GROUP_ID,
          logo: 'https://ik.imagekit.io/kickr/groups/new.png',
        }),
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
      groupModel.find.mockReturnValue(
        q([{ _id: GROUP_ID, name: 'Bangkok FC' }]),
      );

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

  // Rules have no dedicated setRules/getRules any more — they go through
  // update() and are read back from findById() like any other group field.
  describe('rules via update()', () => {
    it('is owner/admin gated', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.update(GROUP_ID, USER_ID, { rules: ['a'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    // The old max-3 cap was removed by product decision: real rule lists are
    // longer than 3 (the reference screenshot has 6).
    it('accepts more than 3 rules — the cap was removed', async () => {
      allowOwner();
      const six = ['a', 'b', 'c', 'd', 'e', 'f'];
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({ _id: GROUP_ID, rules: six }),
      );

      const res: any = await service.update(GROUP_ID, USER_ID, {
        rules: six,
      });

      expect(res.rules).toEqual(six);
    });

    it('stores multi-line and non-ASCII rule text verbatim', async () => {
      allowOwner();
      // Mirrors the Burmese reference list: a newline inside one rule must
      // survive so the client can render it with white-space: pre-line.
      const rules = [
        'ပွဲမတိုင်ခင် ( 15-30 ) မိနစ်\nစောပြီး အရောက်လာပေးပါ။',
        'Line one\n\nLine three',
      ];
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({ _id: GROUP_ID, rules: rules }),
      );

      const res: any = await service.update(GROUP_ID, USER_ID, {
        rules: rules,
      });

      expect(res.rules[0]).toBe(rules[0]);
      expect(res.rules[0]).toContain('\n');
      expect(res.rules[1]).toContain('\n\n');
    });

    it('is readable back from findById', async () => {
      const rules = ['Be on time', 'No slide tackles'];
      groupModel.findById.mockReturnValue(q({ _id: GROUP_ID, rules: rules }));
      memberModel.findOne.mockReturnValue(q(null));

      const res: any = await service.findById(GROUP_ID, USER_ID);

      expect(res.rules).toEqual(rules);
    });
  });

  describe('getMyGroups', () => {
    // The list and detail endpoints must agree on the field name; this used to
    // be `myRole` on the list and `userRole` on detail.
    it("labels the caller's role as `userRole`, matching findById", async () => {
      const gid = new Types.ObjectId();
      memberModel.find.mockReturnValue(q([{ groupId: gid, role: 'admin' }]));
      groupModel.find.mockReturnValue(q([{ _id: gid, name: 'FC' }]));

      const res: any = await service.getMyGroups(USER_ID);

      expect(res[0].userRole).toBe('admin');
      expect(res[0]).not.toHaveProperty('myRole');
    });

    it('only counts approved memberships', async () => {
      memberModel.find.mockReturnValue(q([]));
      groupModel.find.mockReturnValue(q([]));

      await service.getMyGroups(USER_ID);

      expect(memberModel.find.mock.calls[0][0].status).toBe('approved');
    });
  });

  describe('findById', () => {
    it('404s when the group is missing', async () => {
      groupModel.findById.mockReturnValue(q(null));
      await expect(service.findById(GROUP_ID, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the bare group when no caller is supplied', async () => {
      groupModel.findById.mockReturnValue(q({ _id: GROUP_ID, name: 'FC' }));

      const res: any = await service.findById(GROUP_ID);

      expect(res.name).toBe('FC');
      expect(res).not.toHaveProperty('userRole');
      expect(memberModel.findOne).not.toHaveBeenCalled();
    });

    it("reports the caller's role and status", async () => {
      groupModel.findById.mockReturnValue(q({ _id: GROUP_ID, name: 'FC' }));
      memberModel.findOne.mockReturnValue(
        q({ role: 'captain', status: 'approved' }),
      );

      const res: any = await service.findById(GROUP_ID, USER_ID);

      expect(res.userRole).toBe('captain');
      expect(res.memberStatus).toBe('approved');
    });

    it('returns nulls for a non-member', async () => {
      groupModel.findById.mockReturnValue(q({ _id: GROUP_ID }));
      memberModel.findOne.mockReturnValue(q(null));

      const res: any = await service.findById(GROUP_ID, USER_ID);

      expect(res.userRole).toBeNull();
      expect(res.memberStatus).toBeNull();
    });

    // The reason memberStatus exists: a pending request already stores
    // role 'member', so role alone cannot distinguish it from a real member.
    it('distinguishes a pending requester from an approved member', async () => {
      groupModel.findById.mockReturnValue(q({ _id: GROUP_ID }));
      memberModel.findOne.mockReturnValue(
        q({ role: 'member', status: 'pending' }),
      );

      const res: any = await service.findById(GROUP_ID, USER_ID);

      expect(res.userRole).toBe('member');
      expect(res.memberStatus).toBe('pending');
    });
  });

  describe('getQr', () => {
    // Previously owner/admin gated. That check was deliberately removed: any
    // authenticated user may fetch the invite link, because join-by-code now
    // only creates a PENDING request an owner must approve.
    it('is NOT role gated — a non-member can fetch the QR', async () => {
      memberModel.findOne.mockResolvedValue(null);
      groupModel.findById.mockReturnValue(
        q({
          inviteCode: 'shared-code',
          inviteCodeExpiry: new Date(Date.now() + 60 * 60 * 1000),
        }),
      );

      const res = await service.getQr(GROUP_ID);

      expect(res.inviteCode).toBe('shared-code');
    });

    it('mints a code for a non-member when none is valid (no role check)', async () => {
      memberModel.findOne.mockResolvedValue(null);
      groupModel.findById
        .mockReturnValueOnce(q({ _id: GROUP_ID }))
        .mockReturnValueOnce(
          q({ inviteCodeExpiry: new Date(Date.now() + 1000) }),
        );
      groupModel.findByIdAndUpdate.mockResolvedValue({ _id: GROUP_ID });

      const res = await service.getQr(GROUP_ID);

      expect(res.inviteCode).toBeTruthy();
      expect(groupModel.findByIdAndUpdate).toHaveBeenCalled();
    });

    it('mints a code when the group has none, and returns a link containing it', async () => {
      allowOwner();
      groupModel.findById
        .mockReturnValueOnce(q({ _id: GROUP_ID })) // no inviteCode yet
        .mockReturnValueOnce(
          q({ inviteCodeExpiry: new Date(Date.now() + 1000) }),
        );
      groupModel.findByIdAndUpdate.mockResolvedValue({ _id: GROUP_ID });

      const res = await service.getQr(GROUP_ID);

      expect(res.inviteCode).toBeTruthy();
      expect(res.inviteLink).toBe(`http://localhost:3000/g/${res.inviteCode}`);
      // a fresh code was persisted
      expect(groupModel.findByIdAndUpdate).toHaveBeenCalled();
    });

    it('REUSES an unexpired code instead of rotating it (shared QRs keep working)', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(
        q({
          inviteCode: 'existing-code',
          inviteCodeExpiry: new Date(Date.now() + 60 * 60 * 1000),
        }),
      );

      const res = await service.getQr(GROUP_ID);

      expect(res.inviteCode).toBe('existing-code');
      expect(res.inviteLink).toBe('http://localhost:3000/g/existing-code');
      // must NOT have rotated the code
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('is stable across consecutive calls while the code is valid', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(
        q({
          inviteCode: 'stable-code',
          inviteCodeExpiry: new Date(Date.now() + 60 * 60 * 1000),
        }),
      );

      const a = await service.getQr(GROUP_ID);
      const b = await service.getQr(GROUP_ID);
      expect(a.inviteCode).toBe(b.inviteCode);
    });

    it('mints a new code when the existing one has EXPIRED', async () => {
      allowOwner();
      groupModel.findById
        .mockReturnValueOnce(
          q({
            inviteCode: 'old-expired',
            inviteCodeExpiry: new Date(Date.now() - 1000), // in the past
          }),
        )
        .mockReturnValueOnce(
          q({ inviteCodeExpiry: new Date(Date.now() + 1000) }),
        );
      groupModel.findByIdAndUpdate.mockResolvedValue({ _id: GROUP_ID });

      const res = await service.getQr(GROUP_ID);

      expect(res.inviteCode).not.toBe('old-expired');
      expect(groupModel.findByIdAndUpdate).toHaveBeenCalled();
    });
  });

  describe('duplicate handle', () => {
    const dupErr = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { handle: 1 },
    });

    it('create maps a Mongo duplicate-key error to 409, not 500', async () => {
      locationsService.assertOwnedBy.mockResolvedValue({ _id: LOC_ID });
      groupModel.create.mockRejectedValueOnce(dupErr);

      await expect(
        service.create(USER_ID, { name: 'Dup', handle: 'taken' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('update maps a duplicate-key error to 409 as well', async () => {
      allowOwner();
      groupModel.findByIdAndUpdate.mockImplementationOnce(() => {
        throw dupErr;
      });

      await expect(
        service.update(GROUP_ID, USER_ID, { handle: 'taken' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows non-duplicate errors untouched', async () => {
      const boom = new Error('db exploded');
      groupModel.create.mockRejectedValueOnce(boom);

      await expect(
        service.create(USER_ID, { name: 'X' } as any),
      ).rejects.toThrow('db exploded');
    });
  });

  // ---------------------------------------------------------------- TASK 7
  describe('attachLocation', () => {
    const fiveLocations = () =>
      Array.from({ length: 5 }, () => new Types.ObjectId());

    it('is owner/admin gated', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.attachLocation(GROUP_ID, USER_ID, { locationId: LOC_ID }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects a 6th location, naming the limit of 5', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({ locations: fiveLocations() }));

      await expect(
        service.attachLocation(GROUP_ID, USER_ID, { locationId: LOC_ID }),
      ).rejects.toThrow(/5/);
      await expect(
        service.attachLocation(GROUP_ID, USER_ID, { locationId: LOC_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(locationsService.assertOwnedBy).not.toHaveBeenCalled();
    });

    it('verifies caller ownership of an existing location before $addToSet-ing it', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({ locations: [] }));
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({ _id: GROUP_ID, locations: [LOC_ID] }),
      );

      const res: any = await service.attachLocation(GROUP_ID, USER_ID, {
        locationId: LOC_ID,
      });

      expect(locationsService.assertOwnedBy).toHaveBeenCalledWith(
        LOC_ID,
        USER_ID,
      );
      expect(locationsService.create).not.toHaveBeenCalled();
      const patch = groupModel.findByIdAndUpdate.mock.calls[0][1];
      expect(patch.$addToSet.locations.toString()).toBe(LOC_ID);
      expect(res.locations).toEqual([LOC_ID]);
    });

    it('propagates the ownership failure without attaching', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({ locations: [] }));
      locationsService.assertOwnedBy.mockRejectedValue(
        new ForbiddenException('You do not own this location'),
      );

      await expect(
        service.attachLocation(GROUP_ID, USER_ID, { locationId: LOC_ID }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('creates the location first when given an inline payload, then attaches the new id', async () => {
      allowOwner();
      const newId = new Types.ObjectId();
      const payload = { name: 'Lumpini Pitch', lat: 13.75, lng: 100.5 };
      groupModel.findById.mockReturnValue(q({ locations: [] }));
      locationsService.create.mockResolvedValue({ _id: newId });
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({ _id: GROUP_ID, locations: [newId] }),
      );

      await service.attachLocation(GROUP_ID, USER_ID, {
        location: payload,
      });

      // the owning group is stamped on the new location so the group's
      // owner/admin/captain can manage it afterwards (not just the creator)
      expect(locationsService.create).toHaveBeenCalledWith(
        USER_ID,
        payload,
        GROUP_ID,
      );
      expect(locationsService.assertOwnedBy).not.toHaveBeenCalled();
      const patch = groupModel.findByIdAndUpdate.mock.calls[0][1];
      expect(patch.$addToSet.locations.toString()).toBe(newId.toString());
    });

    it('rejects a payload with neither locationId nor location', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({ locations: [] }));

      await expect(
        service.attachLocation(GROUP_ID, USER_ID, {} as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('404s when the group is missing', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q(null));
      await expect(
        service.attachLocation(GROUP_ID, USER_ID, { locationId: LOC_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('detachLocation', () => {
    it('$pulls the ref and does NOT delete the Location row itself', async () => {
      allowOwner();
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({ _id: GROUP_ID, locations: [] }),
      );

      await service.detachLocation(GROUP_ID, USER_ID, LOC_ID);

      const patch = groupModel.findByIdAndUpdate.mock.calls[0][1];
      expect(patch.$pull.locations.toString()).toBe(LOC_ID);
      // detaching is not deleting: the location stays in the owner's library
      expect(locationsService.remove).not.toHaveBeenCalled();
      expect(groupModel.deleteOne).not.toHaveBeenCalled();
    });

    it('is owner/admin gated', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.detachLocation(GROUP_ID, USER_ID, LOC_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('404s when the group is missing', async () => {
      allowOwner();
      groupModel.findByIdAndUpdate.mockReturnValue(q(null));
      await expect(
        service.detachLocation(GROUP_ID, USER_ID, LOC_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listLocations', () => {
    it('populates the location refs and returns them', async () => {
      const populated = [{ _id: LOC_ID, name: 'Lumpini Pitch' }];
      const query = q({ _id: GROUP_ID, locations: populated });
      groupModel.findById.mockReturnValue(query);

      const res = await service.listLocations(GROUP_ID);

      expect(query.populate).toHaveBeenCalledWith('locations');
      expect(res).toEqual(populated);
    });

    it('404s when the group is missing', async () => {
      groupModel.findById.mockReturnValue(q(null));
      await expect(service.listLocations(GROUP_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateMemberRole', () => {
    /** first findOne is the requester gate, second is the target member */
    const gateThenTarget = (target: any) =>
      memberModel.findOne
        .mockResolvedValueOnce({ role: 'owner' })
        .mockResolvedValueOnce(target);

    it('is owner/admin gated', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.updateMemberRole(GROUP_ID, USER_ID, TARGET_ID, {
          role: 'captain',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses to modify a member whose role is owner', async () => {
      gateThenTarget({ role: 'owner' });

      await expect(
        service.updateMemberRole(GROUP_ID, USER_ID, TARGET_ID, {
          role: 'member',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('404s when the target is not a member', async () => {
      gateThenTarget(null);
      await expect(
        service.updateMemberRole(GROUP_ID, USER_ID, TARGET_ID, {
          role: 'admin',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets role and level together', async () => {
      gateThenTarget({ role: 'member' });
      memberModel.findOneAndUpdate.mockReturnValue(
        q({ role: 'captain', level: 3 }),
      );

      const res: any = await service.updateMemberRole(
        GROUP_ID,
        USER_ID,
        TARGET_ID,
        { role: 'captain', level: 3 },
      );

      expect(memberModel.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $set: { role: 'captain', level: 3 },
      });
      expect(res.role).toBe('captain');
      expect(res.level).toBe(3);
    });

    it('sets only level when role is omitted', async () => {
      gateThenTarget({ role: 'member' });
      memberModel.findOneAndUpdate.mockReturnValue(q({ level: 2 }));

      await service.updateMemberRole(GROUP_ID, USER_ID, TARGET_ID, {
        level: 2,
      });

      expect(memberModel.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $set: { level: 2 },
      });
    });

    it('rejects an empty patch', async () => {
      gateThenTarget({ role: 'member' });
      await expect(
        service.updateMemberRole(GROUP_ID, USER_ID, TARGET_ID, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('create with locationIds', () => {
    const dto = (extra: any = {}) => ({ name: 'Bangkok FC', ...extra });

    it('verifies ownership of every id and stores them as group.locations', async () => {
      const a = new Types.ObjectId().toString();
      const b = new Types.ObjectId().toString();
      groupModel.create.mockResolvedValue({ _id: GROUP_ID });
      memberModel.create.mockResolvedValue({});

      await service.create(USER_ID, dto({ locationIds: [a, b] }));

      expect(locationsService.assertOwnedBy).toHaveBeenCalledTimes(2);
      expect(locationsService.assertOwnedBy).toHaveBeenCalledWith(a, USER_ID);
      expect(locationsService.assertOwnedBy).toHaveBeenCalledWith(b, USER_ID);

      const arg = groupModel.create.mock.calls[0][0];
      expect(arg.locations.map((id: any) => id.toString())).toEqual([a, b]);
    });

    it('never passes locationIds through as a stray field on the model', async () => {
      const a = new Types.ObjectId().toString();
      groupModel.create.mockResolvedValue({ _id: GROUP_ID });
      memberModel.create.mockResolvedValue({});

      await service.create(USER_ID, dto({ locationIds: [a] }));

      const arg = groupModel.create.mock.calls[0][0];
      expect(arg).not.toHaveProperty('locationIds');
      expect(arg.name).toBe('Bangkok FC');
    });

    it('rejects more than 5 locationIds before creating anything', async () => {
      const ids = Array.from({ length: 6 }, () =>
        new Types.ObjectId().toString(),
      );

      await expect(
        service.create(USER_ID, dto({ locationIds: ids })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(groupModel.create).not.toHaveBeenCalled();
      expect(memberModel.create).not.toHaveBeenCalled();
    });

    it('does not attach anything when a location is not owned by the creator', async () => {
      locationsService.assertOwnedBy.mockRejectedValue(
        new ForbiddenException('You do not own this location'),
      );

      await expect(
        service.create(USER_ID, dto({ locationIds: [LOC_ID] })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModel.create).not.toHaveBeenCalled();
    });

    it('still creates the group (and the owner membership) with no locationIds', async () => {
      groupModel.create.mockResolvedValue({ _id: GROUP_ID });
      memberModel.create.mockResolvedValue({});

      await service.create(USER_ID, dto());

      expect(locationsService.assertOwnedBy).not.toHaveBeenCalled();
      const arg = groupModel.create.mock.calls[0][0];
      expect(arg).not.toHaveProperty('locationIds');
      expect(arg.ownerId.toString()).toBe(USER_ID);
      expect(memberModel.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({ role: 'owner', status: 'approved' }),
      );
    });
  });

  describe('adopting personal locations (create-location-before-group flow)', () => {
    it('create() hands the supplied locations to the new group', async () => {
      const locA = new Types.ObjectId().toString();
      const newGroupId = new Types.ObjectId();
      groupModel.create.mockResolvedValue({ _id: newGroupId });
      memberModel.create.mockResolvedValue({});

      await service.create(USER_ID, {
        name: 'Flow FC',
        locationIds: [locA],
      });

      // the location was created before the group existed, so it starts
      // personal — the group must take ownership once it has an id
      expect(locationsService.adoptPersonalLocations).toHaveBeenCalledWith(
        expect.arrayContaining([expect.anything()]),
        USER_ID,
        newGroupId.toString(),
      );
    });

    it('create() skips adoption when no locations were supplied', async () => {
      groupModel.create.mockResolvedValue({ _id: new Types.ObjectId() });
      memberModel.create.mockResolvedValue({});
      await service.create(USER_ID, { name: 'No Loc FC' });
      expect(locationsService.adoptPersonalLocations).not.toHaveBeenCalled();
    });

    it('attachLocation() also adopts a still-personal location', async () => {
      allowOwner();
      groupModel.findById.mockReturnValue(q({ locations: [] }));
      groupModel.findByIdAndUpdate.mockReturnValue(
        q({ _id: GROUP_ID, locations: [LOC_ID] }),
      );

      await service.attachLocation(GROUP_ID, USER_ID, { locationId: LOC_ID });

      expect(locationsService.adoptPersonalLocations).toHaveBeenCalledWith(
        [expect.anything()],
        USER_ID,
        GROUP_ID,
      );
    });
  });
});
