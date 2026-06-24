import {
  Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { GroupMember, GroupMemberDocument } from '../groups/schemas/group-member.schema';
import { RespondInvitationDto } from './dto/respond-invitation.dto';

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
  ) {}

  async requestToJoin(groupId: string, userId: string) {
    const group = await this.groupModel.findById(groupId);
    if (!group) throw new NotFoundException('Group not found');

    const existing = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
    });
    if (existing) throw new ConflictException('Already a member or request pending');

    await this.memberModel.create({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      role: 'member',
      status: 'pending',
    });

    return { message: 'Join request sent. Waiting for approval.' };
  }

  async listPending(groupId: string, requesterId: string) {
    await this.assertOwnerOrAdmin(groupId, requesterId);
    return this.memberModel
      .find({ groupId: new Types.ObjectId(groupId), status: 'pending' })
      .populate('userId', 'name email profileImage')
      .lean();
  }

  async respond(groupId: string, invitationId: string, requesterId: string, dto: RespondInvitationDto) {
    await this.assertOwnerOrAdmin(groupId, requesterId);

    const invitation = await this.memberModel.findOne({
      _id: invitationId,
      groupId: new Types.ObjectId(groupId),
      status: 'pending',
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    if (dto.action === 'approved') {
      invitation.status = 'approved';
      invitation.joinedAt = new Date();
      await invitation.save();
      return { message: 'Member approved' };
    } else {
      await invitation.deleteOne();
      return { message: 'Invitation rejected' };
    }
  }

  async joinByCode(code: string, userId: string) {
    const group = await this.groupModel.findOne({
      inviteCode: code,
      inviteCodeExpiry: { $gt: new Date() },
    });
    if (!group) throw new BadRequestException('Invalid or expired invite code');

    const existing = await this.memberModel.findOne({
      groupId: group._id,
      userId: new Types.ObjectId(userId),
    });
    if (existing) throw new ConflictException('Already a member or request pending');

    await this.memberModel.create({
      groupId: group._id,
      userId: new Types.ObjectId(userId),
      role: 'member',
      status: 'approved',
      joinedAt: new Date(),
    });

    return { message: 'Joined group successfully', groupId: group._id };
  }

  private async assertOwnerOrAdmin(groupId: string, userId: string) {
    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
      role: { $in: ['owner', 'admin'] },
    });
    if (!member) throw new ForbiddenException('Only group owner or admin can perform this action');
  }
}
