import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Group, GroupDocument } from './schemas/group.schema';
import { GroupMember, GroupMemberDocument } from './schemas/group-member.schema';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { ImageKitService } from '../common/upload/imagekit.service';
import { LocationsService } from '../locations/locations.service';

/** Escapes user input so it can be embedded in a RegExp literally. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
    private readonly imagekit: ImageKitService,
    private readonly locationsService: LocationsService,
    private config: ConfigService,
  ) {}

  async getMyGroups(userId: string) {
    const memberships = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: 'approved' })
      .lean();
    const groupIds = memberships.map((m) => m.groupId);
    const groups = await this.groupModel.find({ _id: { $in: groupIds } }).lean();
    return groups.map((group) => ({
      ...group,
      myRole: memberships.find((m) => m.groupId.toString() === (group._id as any).toString())?.role,
    }));
  }

  async create(ownerId: string, dto: CreateGroupDto): Promise<GroupDocument> {
    const group = await this.groupModel.create({
      ...dto,
      ownerId: new Types.ObjectId(ownerId),
    });
    await this.memberModel.create({
      groupId: group._id,
      userId: new Types.ObjectId(ownerId),
      role: 'owner',
      status: 'approved',
      joinedAt: new Date(),
    });
    return group;
  }

  async findById(groupId: string): Promise<GroupDocument> {
    const group = await this.groupModel.findById(groupId).lean();
    if (!group) throw new NotFoundException('Group not found');
    return group as unknown as GroupDocument;
  }

  async update(groupId: string, userId: string, dto: UpdateGroupDto): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);
    const group = await this.groupModel
      .findByIdAndUpdate(groupId, { $set: dto }, { new: true })
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group as unknown as GroupDocument;
  }

  async updateWallpaper(
    groupId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<GroupDocument> {
    return this.replaceGroupImage(groupId, userId, file, 'wallpaper', 'wallpaperFileId');
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

    const current = await this.groupModel.findById(groupId).select(fileIdField).lean();
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
    return group as unknown as GroupDocument;
  }

  /** Public discovery: private groups are never searchable. */
  async search(q: string) {
    const rx = new RegExp(escapeRegex(q ?? ''), 'i');
    return this.groupModel
      .find({ isPrivate: false, $or: [{ name: rx }, { handle: rx }] })
      .limit(20)
      .lean();
  }

  async getQr(
    groupId: string,
    userId: string,
  ): Promise<{ inviteCode: string; inviteLink: string }> {
    // generateInviteCode is already owner/admin gated
    const code = await this.generateInviteCode(groupId, userId);
    const base = this.config.get<string>('APP_BASE_URL') ?? '';
    return { inviteCode: code, inviteLink: `${base}/g/${code}` };
  }

  async setRules(groupId: string, userId: string, rules: string[]): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);
    if (rules.length > 3) {
      throw new BadRequestException('A group may have at most 3 rules');
    }
    const group = await this.groupModel
      .findByIdAndUpdate(groupId, { $set: { teamRules: rules } }, { new: true })
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group as unknown as GroupDocument;
  }

  async getRules(groupId: string): Promise<{ rules: string[] }> {
    const group = await this.groupModel.findById(groupId).select('teamRules').lean();
    if (!group) throw new NotFoundException('Group not found');
    return { rules: (group as any).teamRules ?? [] };
  }

  async listMembers(groupId: string) {
    return this.memberModel
      .find({ groupId: new Types.ObjectId(groupId), status: 'approved' })
      .populate('userId', 'name email profileImage')
      .lean();
  }

  async removeMember(groupId: string, requesterId: string, targetUserId: string) {
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
    if (!member) throw new ForbiddenException('Only group owner or admin can perform this action');
  }
}
