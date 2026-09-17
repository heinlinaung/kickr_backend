// src/photos/photos.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PhotosService } from './photos.service';
import {
  MAX_PHOTOS_PER_TARGET,
  Photo,
} from './schemas/photo.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import { PlansService } from '../plans/plans.service';
import { DEFAULT_PLAN_LIMITS } from '../plans/plans';
import { plansDouble } from '../events/events.test-providers';

const GROUP = '6a6b2366f78b66d63a911a9e';
const EVENT = '507f1f77bcf86cd799439011';
const USER = '507f191e810c19729de860e1';

describe('PhotosService', () => {
  let service: PhotosService;
  const photoModel: any = {};
  const memberModel: any = {};
  const imagekit: any = {};
  let plansService: ReturnType<typeof plansDouble>;

  const file = { buffer: Buffer.from('x') } as any;

  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    photoModel.countDocuments = jest.fn().mockResolvedValue(0);
    photoModel.create = jest.fn().mockResolvedValue({ _id: 'p1' });
    photoModel.find = jest.fn().mockReturnValue(chain([]));
    photoModel.findOneAndDelete = jest
      .fn()
      .mockResolvedValue({ fileId: 'f1' });
    photoModel.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });
    memberModel.findOne = jest.fn().mockReturnValue(chain(null));
    imagekit.upload = jest
      .fn()
      .mockResolvedValue({ url: 'https://ik/p.jpg', fileId: 'new-file' });
    imagekit.deleteFile = jest.fn().mockResolvedValue(undefined);

    plansService = plansDouble();
    const m = await Test.createTestingModule({
      providers: [
        PhotosService,
        { provide: getModelToken(Photo.name), useValue: photoModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: ImageKitService, useValue: imagekit },
        { provide: PlansService, useValue: plansService },
      ],
    }).compile();
    service = m.get(PhotosService);
  });

  describe('the 30-per-target cap (events; groups use the plan cap instead)', () => {
    it(`allows the ${MAX_PHOTOS_PER_TARGET}th photo`, async () => {
      photoModel.countDocuments.mockResolvedValue(MAX_PHOTOS_PER_TARGET - 1);

      await expect(
        service.add('event', EVENT, USER, file),
      ).resolves.toBeDefined();
    });

    it('refuses the one after that', async () => {
      photoModel.countDocuments.mockResolvedValue(MAX_PHOTOS_PER_TARGET);

      await expect(
        service.add('event', EVENT, USER, file),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('counts BEFORE uploading, so a refusal never reaches ImageKit', async () => {
      // Uploading first would leave an orphaned remote file on every refusal —
      // billable, and invisible from the database.
      photoModel.countDocuments.mockResolvedValue(MAX_PHOTOS_PER_TARGET);

      await expect(service.add('event', EVENT, USER, file)).rejects.toThrow();

      expect(imagekit.upload).not.toHaveBeenCalled();
      expect(photoModel.create).not.toHaveBeenCalled();
    });

    it('counts per TARGET, not globally', async () => {
      // A group at its limit must not block an event from having any.
      await service.add('event', EVENT, USER, file);

      const filter = photoModel.countDocuments.mock.calls[0][0];
      expect(filter.targetType).toBe('event');
      expect(String(filter.targetId)).toBe(EVENT);
    });

    it("does not apply to a group's own photos", async () => {
      // Their budget is the plan's gallery cap — 30 here would stop a group
      // ever reaching its plan's 50 with its own uploads.
      photoModel.countDocuments.mockResolvedValue(MAX_PHOTOS_PER_TARGET);

      await expect(
        service.add('group', GROUP, USER, file),
      ).resolves.toBeDefined();
    });
  });

  describe("the plan's gallery cap (50 per group on the default plan)", () => {
    const CAP = DEFAULT_PLAN_LIMITS.maxGalleryPhotosPerGroup;

    it(`allows the ${CAP}th gallery photo`, async () => {
      photoModel.countDocuments.mockResolvedValue(CAP - 1);

      await expect(
        service.add('group', GROUP, USER, file),
      ).resolves.toBeDefined();
    });

    it('refuses the one after that, telling the caller to delete first', async () => {
      photoModel.countDocuments.mockResolvedValue(CAP);

      await expect(service.add('group', GROUP, USER, file)).rejects.toThrow(
        /Delete existing image\(s\)/,
      );
      expect(imagekit.upload).not.toHaveBeenCalled();
    });

    it("counts the whole GALLERY — the same $or as listForGroup", async () => {
      // The cap is on what GET /groups/:id/photos shows, so event photos
      // count against it too.
      await service.add('group', GROUP, USER, file);

      const filter = photoModel.countDocuments.mock.calls[0][0];
      expect(filter.$or).toHaveLength(2);
      expect(filter.$or[0].targetType).toBe('group');
      expect(String(filter.$or[0].targetId)).toBe(GROUP);
      expect(String(filter.$or[1].groupId)).toBe(GROUP);
    });

    it("meters an EVENT upload against its group's gallery too", async () => {
      // Per-target count first (0), then the gallery count at the cap.
      photoModel.countDocuments
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(CAP);

      await expect(
        service.add('event', EVENT, USER, file, GROUP),
      ).rejects.toThrow(/gallery/);
      expect(plansService.limitsForGroupOwner).toHaveBeenCalledWith(GROUP);
    });

    it('leaves a STANDALONE event out of any gallery math', async () => {
      await service.add('event', EVENT, USER, file, null);

      expect(plansService.limitsForGroupOwner).not.toHaveBeenCalled();
      // Only the per-target count ran.
      expect(photoModel.countDocuments).toHaveBeenCalledTimes(1);
    });

    it("asks for the group OWNER's limits, not the uploader's", async () => {
      await service.add('group', GROUP, USER, file);

      expect(plansService.limitsForGroupOwner).toHaveBeenCalledWith(GROUP);
      expect(plansService.limitsFor).not.toHaveBeenCalled();
    });
  });

  describe('storing', () => {
    it('records who uploaded it', async () => {
      // The old embedded EventPhoto kept only {url, fileId}, so a photo could
      // not be attributed. Recorded from the start here.
      await service.add('group', GROUP, USER, file);

      expect(String(photoModel.create.mock.calls[0][0].uploadedBy)).toBe(USER);
    });

    it('tags an event photo with its group', async () => {
      // The denormalised link that puts it in the group gallery.
      await service.add('event', EVENT, USER, file, GROUP);

      expect(String(photoModel.create.mock.calls[0][0].groupId)).toBe(GROUP);
    });

    it('leaves groupId null for a group\'s own photo', async () => {
      // targetId already identifies the group; setting both would double-count
      // it in the gallery $or.
      await service.add('group', GROUP, USER, file, null);

      expect(photoModel.create.mock.calls[0][0].groupId).toBeNull();
    });
  });

  describe('the group gallery', () => {
    it("unions the group's own photos with its events'", async () => {
      // The requirement: an event photo appears here without being copied.
      await service.listForGroup(GROUP);

      const filter = photoModel.find.mock.calls[0][0];
      expect(filter.$or).toHaveLength(2);
      expect(filter.$or[0].targetType).toBe('group');
      expect(String(filter.$or[0].targetId)).toBe(GROUP);
      expect(String(filter.$or[1].groupId)).toBe(GROUP);
    });

    it('sorts newest first with _id as the tiebreaker', async () => {
      // A multi-file upload produces several photos in the same millisecond.
      const q = chain([]);
      photoModel.find.mockReturnValue(q);

      await service.listForGroup(GROUP);

      expect(q.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    });
  });

  describe('removing', () => {
    it('scopes the delete to the target', async () => {
      // So a fileId belonging to another target cannot be deleted through the
      // wrong route.
      await service.remove('group', GROUP, 'f1');

      const filter = photoModel.findOneAndDelete.mock.calls[0][0];
      expect(filter.targetType).toBe('group');
      expect(String(filter.targetId)).toBe(GROUP);
      expect(filter.fileId).toBe('f1');
    });

    it('404s when the photo is not on that target', async () => {
      photoModel.findOneAndDelete.mockResolvedValue(null);

      await expect(
        service.remove('group', GROUP, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(imagekit.deleteFile).not.toHaveBeenCalled();
    });

    it('does NOT fail when the remote delete fails', async () => {
      // The row is already gone, so failing here would report a deletion that
      // did happen as an error.
      imagekit.deleteFile.mockRejectedValue(new Error('imagekit down'));

      await expect(service.remove('group', GROUP, 'f1')).resolves.toBeDefined();
    });
  });

  describe('membership checks', () => {
    it('reports the approved role', async () => {
      memberModel.findOne.mockReturnValue(chain({ role: 'admin' }));

      expect(await service.memberRole(GROUP, USER)).toBe('admin');
    });

    it('requires APPROVED membership', async () => {
      // A pending request is not membership — the same rule as chat and the
      // member list.
      await service.memberRole(GROUP, USER);

      expect(memberModel.findOne.mock.calls[0][0].status).toBe('approved');
    });

    it.each([
      ['owner', true],
      ['admin', true],
      ['captain', false],
      ['member', false],
    ])('isGroupManager(%s) === %s', async (role, expected) => {
      memberModel.findOne.mockReturnValue(chain({ role }));

      expect(await service.isGroupManager(GROUP, USER)).toBe(expected);
    });

    it('is false for a non-member', async () => {
      memberModel.findOne.mockReturnValue(chain(null));

      expect(await service.isGroupManager(GROUP, USER)).toBe(false);
    });
  });
});
