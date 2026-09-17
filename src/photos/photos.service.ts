// src/photos/photos.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MAX_PHOTOS_PER_TARGET,
  Photo,
  PhotoDocument,
  PhotoTarget,
} from './schemas/photo.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { PlansService } from '../plans/plans.service';

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    @InjectModel(Photo.name) private photoModel: Model<PhotoDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    private readonly imagekit: ImageKitService,
    private readonly plansService: PlansService,
  ) {}

  /**
   * The caller's approved role in a group, or `null`.
   *
   * Duplicated from `GroupsService.getMemberRole` rather than importing
   * GroupsModule, which would close a cycle:
   * GroupsModule -> EventsModule -> PhotosModule -> GroupsModule. That cycle
   * is not theoretical — it failed at boot with UndefinedModuleException, and
   * `forwardRef` would paper over it rather than remove it.
   *
   * Registering the schema instead keeps this module a leaf. The duplication
   * is four lines of query, against a permanent structural coupling.
   */
  async memberRole(groupId: string, userId: string): Promise<string | null> {
    const member = await this.memberModel
      .findOne({
        groupId: new Types.ObjectId(groupId),
        userId: new Types.ObjectId(userId),
        status: 'approved',
      })
      .select('role')
      .lean();
    return member?.role ?? null;
  }

  /** True when the caller may upload to or delete from a group's gallery. */
  async isGroupManager(groupId: string, userId: string): Promise<boolean> {
    const role = await this.memberRole(groupId, userId);
    return role === 'owner' || role === 'admin';
  }

  /**
   * Stores one photo against a target.
   *
   * Permission is the CALLER's job — this service knows nothing about groups or
   * events, which is what lets a tournament use it later without teaching it a
   * third ownership model.
   *
   * `groupId` is the denormalised link that puts an event's photo in its
   * group's gallery; pass `null` for a group's own photo or a groupless event.
   */
  async add(
    targetType: PhotoTarget,
    targetId: string,
    uploadedBy: string,
    file: Express.Multer.File,
    groupId: string | null = null,
  ) {
    // Both caps are counted BEFORE the upload, so a rejected photo never
    // reaches ImageKit. Uploading first would leave an orphaned remote file on
    // every refusal — billable, and invisible from the database.

    // Per-target sanity cap for events (and tournaments later). A GROUP's own
    // photos are exempt: their budget is the gallery cap below, which the
    // plan sets higher than this — capping them here too would stop a group
    // ever reaching its plan's gallery allowance with its own uploads.
    if (targetType !== 'group') {
      const existing = await this.photoModel.countDocuments({
        targetType,
        targetId: new Types.ObjectId(targetId),
      });
      if (existing >= MAX_PHOTOS_PER_TARGET) {
        throw new BadRequestException(
          `This ${targetType} already has the maximum of ${MAX_PHOTOS_PER_TARGET} photos. Delete one before adding another.`,
        );
      }
    }

    // Plan gate: the owning group's GALLERY — its own photos plus its events'
    // (the same $or as listForGroup) — is capped by the group OWNER's plan.
    // Checked for the group's own uploads and for event uploads carrying a
    // groupId alike, since both land in that gallery; a standalone event has
    // no gallery to fill. Full means full: freeing a slot takes deleting an
    // existing image.
    const galleryGroupId = targetType === 'group' ? targetId : groupId;
    if (galleryGroupId) {
      const limits = await this.plansService.limitsForGroupOwner(
        galleryGroupId,
      );
      const gid = new Types.ObjectId(galleryGroupId);
      const inGallery = await this.photoModel.countDocuments({
        $or: [{ targetType: 'group', targetId: gid }, { groupId: gid }],
      });
      if (inGallery >= limits.maxGalleryPhotosPerGroup) {
        throw new BadRequestException(
          `This group's gallery already holds the maximum of ` +
            `${limits.maxGalleryPhotosPerGroup} photos allowed by its plan. ` +
            'Delete existing image(s) before adding more.',
        );
      }
    }

    const uploaded = await this.imagekit.upload(
      file.buffer,
      `${targetType}-${targetId}-${Date.now()}`,
      `${targetType}s/photos`,
    );

    await this.photoModel.create({
      targetType,
      targetId: new Types.ObjectId(targetId),
      groupId: groupId ? new Types.ObjectId(groupId) : null,
      url: uploaded.url,
      fileId: uploaded.fileId,
      uploadedBy: new Types.ObjectId(uploadedBy),
    });

    return this.list(targetType, targetId);
  }

  /** Every photo on one target, newest first. */
  async list(targetType: PhotoTarget, targetId: string) {
    const photos = await this.photoModel
      .find({ targetType, targetId: new Types.ObjectId(targetId) })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return { photos };
  }

  /**
   * A group's gallery: its own photos PLUS those of its events.
   *
   * The `$or` is what makes an event photo visible here without copying the
   * row. Matching on `targetId` alone would miss the event photos; matching on
   * `groupId` alone would miss the group's own, which carry `groupId: null`
   * because `targetId` already identifies the group.
   */
  async listForGroup(groupId: string) {
    const id = new Types.ObjectId(groupId);

    const photos = await this.photoModel
      .find({
        $or: [{ targetType: 'group', targetId: id }, { groupId: id }],
      })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return { photos };
  }

  /**
   * Deletes a photo row, then its remote file.
   *
   * That order on purpose: if ImageKit fails we would rather leak a file than
   * leave a row whose URL 404s. A leaked file costs storage; a broken URL is
   * visible to every viewer of the gallery.
   */
  async remove(targetType: PhotoTarget, targetId: string, fileId: string) {
    const photo = await this.photoModel.findOneAndDelete({
      targetType,
      targetId: new Types.ObjectId(targetId),
      fileId,
    });
    if (!photo) throw new NotFoundException('Photo not found');

    try {
      await this.imagekit.deleteFile(fileId);
    } catch (err) {
      // Swallowed deliberately — the row is already gone, so failing the
      // request would report a deletion that did happen as an error.
      this.logger.warn(`Failed to delete remote file ${fileId}: ${err}`);
    }

    return this.list(targetType, targetId);
  }

  /**
   * Removes every photo for a target, for cascade deletes.
   *
   * Rows first, then the remote files, best-effort — a group delete must not
   * fail because ImageKit had a bad minute.
   */
  async removeAllForTarget(targetType: PhotoTarget, targetId: string) {
    const id = new Types.ObjectId(targetId);
    const photos = await this.photoModel
      .find({ targetType, targetId: id })
      .select('fileId')
      .lean();

    if (!photos.length) return { photos: 0 };

    await this.photoModel.deleteMany({ targetType, targetId: id });

    for (const photo of photos) {
      try {
        await this.imagekit.deleteFile(photo.fileId);
      } catch (err) {
        this.logger.warn(`Failed to delete remote file ${photo.fileId}: ${err}`);
      }
    }

    return { photos: photos.length };
  }
}
