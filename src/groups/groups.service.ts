import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Group, GroupDocument } from './schemas/group.schema';
import { GroupMember, GroupMemberDocument } from './schemas/group-member.schema';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
  ) {}

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

  async updateWallpaper(groupId: string, userId: string, filename: string): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);
    const group = await this.groupModel
      .findByIdAndUpdate(
        groupId,
        { $set: { wallpaper: `/uploads/groups/${filename}` } },
        { new: true },
      )
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group as unknown as GroupDocument;
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
