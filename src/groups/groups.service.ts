import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Group, GroupDocument } from './schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from './schemas/group-member.schema';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AttachLocationDto } from './dto/attach-location.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { ImageKitService } from '../common/upload/imagekit.service';
import { LocationsService } from '../locations/locations.service';

/** Escapes user input so it can be embedded in a RegExp literally. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class GroupsService {
  private static readonly MAX_LOCATIONS = 5;

  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    private readonly imagekit: ImageKitService,
    private readonly locationsService: LocationsService,
    private config: ConfigService,
  ) {}

  async getMyGroups(userId: string) {
    const memberships = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: 'approved' })
      .lean();
    const groupIds = memberships.map((m) => m.groupId);
    const groups = await this.groupModel
      .find({ _id: { $in: groupIds } })
      .lean();
    return groups.map((group) => ({
      ...group,
      myRole: memberships.find(
        (m) => m.groupId.toString() === (group._id as any).toString(),
      )?.role,
    }));
  }

  async create(ownerId: string, dto: CreateGroupDto): Promise<GroupDocument> {
    // locationIds is a DTO-only field: it must be destructured out rather than
    // spread into the model. Mongoose's create() typing is loose enough that an
    // unknown field is silently dropped with no compile error, so the mapping to
    // `locations` is done explicitly here.
    const { locationIds, ...rest } = dto;
    const locations = await this.resolveOwnedLocationIds(locationIds, ownerId);

    let group: GroupDocument;
    try {
      group = await this.groupModel.create({
        ...rest,
        ...(locations ? { locations } : {}),
        ownerId: new Types.ObjectId(ownerId),
      });
    } catch (err: unknown) {
      // `handle` has a unique index — surface a clean 409 instead of the raw
      // Mongo duplicate-key error (which would otherwise become a 500).
      throw this.mapDuplicateKey(err);
    }
    await this.memberModel.create({
      groupId: group._id,
      userId: new Types.ObjectId(ownerId),
      role: 'owner',
      status: 'approved',
      joinedAt: new Date(),
    });

    // Mobile creates the location first (the group has no id yet), so those
    // rows start out personal. Now that the group exists, hand ownership over
    // so its owner/admin/captain can maintain them.
    if (locations?.length) {
      await this.locationsService.adoptPersonalLocations(
        locations,
        ownerId,
        group._id.toString(),
      );
    }

    return group;
  }

  async findById(groupId: string): Promise<GroupDocument> {
    const group = await this.groupModel.findById(groupId).lean();
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async update(
    groupId: string,
    userId: string,
    dto: UpdateGroupDto,
  ): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);
    let group: GroupDocument | null;
    try {
      group = await this.groupModel
        .findByIdAndUpdate(groupId, { $set: dto }, { new: true })
        .lean();
    } catch (err: unknown) {
      throw this.mapDuplicateKey(err);
    }
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  /**
   * Turns a Mongo duplicate-key error into a 409 with a useful message.
   * Without this a taken `handle` surfaces as an opaque 500.
   */
  private mapDuplicateKey(err: unknown): unknown {
    const e = err as { code?: number; keyPattern?: Record<string, unknown> };
    if (e?.code === 11000) {
      const field = Object.keys(e.keyPattern ?? {})[0];
      if (field === 'handle') {
        return new ConflictException('That handle is already taken');
      }
      return new ConflictException(
        field ? `${field} already exists` : 'Duplicate value',
      );
    }
    return err;
  }

  async updateWallpaper(
    groupId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<GroupDocument> {
    return this.replaceGroupImage(
      groupId,
      userId,
      file,
      'wallpaper',
      'wallpaperFileId',
    );
  }

  async updateLogo(
    groupId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<GroupDocument> {
    return this.replaceGroupImage(groupId, userId, file, 'logo', 'logoFileId');
  }

  /**
   * Shared owner/admin-gated ImageKit swap for the group's images: upload the
   * new file, best-effort delete the one it replaces (a failed delete must not
   * fail the update, but we log so orphaned CDN files stay traceable), then
   * persist the new url + fileId.
   */
  private async replaceGroupImage(
    groupId: string,
    userId: string,
    file: Express.Multer.File,
    urlField: 'wallpaper' | 'logo',
    fileIdField: 'wallpaperFileId' | 'logoFileId',
  ): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);

    const current = await this.groupModel
      .findById(groupId)
      .select(fileIdField)
      .lean();
    if (!current) throw new NotFoundException('Group not found');

    const uploaded = await this.imagekit.upload(
      file.buffer,
      `${groupId}-${urlField}-${Date.now()}`,
      'groups',
    );

    const prevFileId = (current as any)[fileIdField];
    if (prevFileId) {
      try {
        await this.imagekit.deleteFile(prevFileId);
      } catch (err) {
        this.logger.warn(
          `Failed to delete previous group ${urlField} ${prevFileId}: ${err}`,
        );
      }
    }

    const group = await this.groupModel
      .findByIdAndUpdate(
        groupId,
        { $set: { [urlField]: uploaded.url, [fileIdField]: uploaded.fileId } },
        { new: true },
      )
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  /** Public discovery: private groups are never searchable. */
  async search(q: string) {
    const rx = new RegExp(escapeRegex(q ?? ''), 'i');
    return this.groupModel
      .find({ isPrivate: false, $or: [{ name: rx }, { handle: rx }] })
      .limit(20)
      .lean();
  }

  /**
   * Returns the group's shareable invite code/link.
   *
   * Reuses the existing code while it is still valid so a shared or printed QR
   * keeps working; only mints a new one when there is none or it has expired.
   * Use `generateInviteCode` directly to deliberately rotate (invalidating any
   * previously shared QR).
   */
  async getQr(
    groupId: string,
    userId: string,
  ): Promise<{
    inviteCode: string;
    inviteLink: string;
    expiresAt: Date | null;
  }> {
    await this.assertOwnerOrAdmin(groupId, userId);
    const group = await this.groupModel
      .findById(groupId)
      .select('inviteCode inviteCodeExpiry')
      .lean();
    if (!group) throw new NotFoundException('Group not found');

    const existingCode = group.inviteCode;
    const existingExpiry = group.inviteCodeExpiry;
    const stillValid =
      !!existingCode &&
      (!existingExpiry || new Date(existingExpiry).getTime() > Date.now());

    let code: string;
    let expiresAt: Date | null;
    if (stillValid) {
      code = existingCode;
      expiresAt = existingExpiry ? new Date(existingExpiry) : null;
    } else {
      code = await this.generateInviteCode(groupId, userId);
      const refreshed = await this.groupModel
        .findById(groupId)
        .select('inviteCodeExpiry')
        .lean();
      const refreshedExpiry = refreshed?.inviteCodeExpiry;
      expiresAt = refreshedExpiry ? new Date(refreshedExpiry) : null;
    }

    const base = this.config.get<string>('APP_BASE_URL') ?? '';
    return { inviteCode: code, inviteLink: `${base}/g/${code}`, expiresAt };
  }

  async setRules(
    groupId: string,
    userId: string,
    rules: string[],
  ): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);
    if (rules.length > 3) {
      throw new BadRequestException('A group may have at most 3 rules');
    }
    const group = await this.groupModel
      .findByIdAndUpdate(groupId, { $set: { teamRules: rules } }, { new: true })
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async getRules(groupId: string): Promise<{ rules: string[] }> {
    const group = await this.groupModel
      .findById(groupId)
      .select('teamRules')
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return { rules: (group as any).teamRules ?? [] };
  }

  async listMembers(groupId: string) {
    return this.memberModel
      .find({ groupId: new Types.ObjectId(groupId), status: 'approved' })
      .populate('userId', 'name email profileImage')
      .lean();
  }

  async removeMember(
    groupId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    await this.assertOwnerOrAdmin(groupId, requesterId);

    const targetMember = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(targetUserId),
    });
    if (targetMember?.role === 'owner') {
      throw new ForbiddenException('Cannot remove the group owner');
    }

    await this.memberModel.deleteOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(targetUserId),
    });
    return { message: 'Member removed' };
  }

  async generateInviteCode(groupId: string, userId: string): Promise<string> {
    await this.assertOwnerOrAdmin(groupId, userId);
    const code = uuidv4();
    await this.groupModel.findByIdAndUpdate(groupId, {
      $set: {
        inviteCode: code,
        inviteCodeExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return code;
  }

  async updateMemberRole(
    groupId: string,
    requesterId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ) {
    await this.assertOwnerOrAdmin(groupId, requesterId);

    const target = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(targetUserId),
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') {
      throw new ForbiddenException("Cannot change the group owner's role");
    }

    const patch: Record<string, unknown> = {};
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.level !== undefined) patch.level = dto.level;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Provide at least one of role or level');
    }

    const member = await this.memberModel
      .findOneAndUpdate(
        {
          groupId: new Types.ObjectId(groupId),
          userId: new Types.ObjectId(targetUserId),
        },
        { $set: patch },
        { new: true },
      )
      .lean();
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async listLocations(groupId: string) {
    const group = await this.groupModel
      .findById(groupId)
      .populate('locations')
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return (group as any).locations ?? [];
  }

  async attachLocation(
    groupId: string,
    userId: string,
    dto: AttachLocationDto,
  ): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);

    const current = await this.groupModel
      .findById(groupId)
      .select('locations')
      .lean();
    if (!current) throw new NotFoundException('Group not found');
    if (
      ((current as any).locations ?? []).length >= GroupsService.MAX_LOCATIONS
    ) {
      throw new BadRequestException(
        `A group may have at most ${GroupsService.MAX_LOCATIONS} locations`,
      );
    }

    let locationId: string;
    if (dto.locationId) {
      // you may only attach locations you own
      await this.locationsService.assertOwnedBy(dto.locationId, userId);
      locationId = dto.locationId;
    } else if (dto.location) {
      // Created in a group context -> owned by the group, so the group's
      // owner/admin/captain can manage it afterwards.
      const created = await this.locationsService.create(
        userId,
        dto.location,
        groupId,
      );
      locationId = created._id.toString();
    } else {
      throw new BadRequestException('Provide either locationId or location');
    }

    const group = await this.groupModel
      .findByIdAndUpdate(
        groupId,
        { $addToSet: { locations: new Types.ObjectId(locationId) } },
        { new: true },
      )
      .lean();
    if (!group) throw new NotFoundException('Group not found');

    // Attaching one of your still-personal locations hands it to the group so
    // the group's owner/admin/captain can maintain it. Locations already owned
    // by another group are left untouched.
    await this.locationsService.adoptPersonalLocations(
      [new Types.ObjectId(locationId)],
      userId,
      groupId,
    );

    return group;
  }

  /**
   * Detaching only removes the group's reference: the Location row stays in its
   * owner's library, where it may still be attached to other groups.
   */
  async detachLocation(
    groupId: string,
    userId: string,
    locationId: string,
  ): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);
    const group = await this.groupModel
      .findByIdAndUpdate(
        groupId,
        { $pull: { locations: new Types.ObjectId(locationId) } },
        { new: true },
      )
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  /**
   * Validates the count and the caller's ownership of every supplied location id
   * and maps them to ObjectIds. Returns undefined when nothing was supplied, so
   * callers can leave the schema default in place.
   */
  private async resolveOwnedLocationIds(
    locationIds: string[] | undefined,
    userId: string,
  ): Promise<Types.ObjectId[] | undefined> {
    if (!locationIds || locationIds.length === 0) return undefined;
    if (locationIds.length > GroupsService.MAX_LOCATIONS) {
      throw new BadRequestException(
        `A group may have at most ${GroupsService.MAX_LOCATIONS} locations`,
      );
    }
    for (const id of locationIds) {
      await this.locationsService.assertOwnedBy(id, userId);
    }
    return locationIds.map((id) => new Types.ObjectId(id));
  }

  async getMemberRole(groupId: string, userId: string): Promise<string | null> {
    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
    });
    return member?.role ?? null;
  }

  async assertOwnerOrAdmin(groupId: string, userId: string) {
    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
      role: { $in: ['owner', 'admin'] },
    });
    if (!member)
      throw new ForbiddenException(
        'Only group owner or admin can perform this action',
      );
  }
}
