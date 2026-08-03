import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { RespondInvitationDto } from './dto/respond-invitation.dto';
import { GroupsService } from '../groups/groups.service';

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    private groupsService: GroupsService,
  ) {}

  async requestToJoin(groupId: string, userId: string) {
    const group = await this.groupModel.findById(groupId);
    if (!group) throw new NotFoundException('Group not found');

    const existing = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
    });
    if (existing)
      throw new ConflictException('Already a member or request pending');

    await this.memberModel.create({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      role: 'member',
      status: 'pending',
    });

    return { message: 'Join request sent. Waiting for approval.' };
  }

  async listPending(groupId: string, requesterId: string) {
    await this.groupsService.assertOwnerOrAdmin(groupId, requesterId);
    return this.memberModel
      .find({ groupId: new Types.ObjectId(groupId), status: 'pending' })
      .populate('userId', 'name email profileImage')
      .lean();
  }

  async respond(
    groupId: string,
    invitationId: string,
    requesterId: string,
    dto: RespondInvitationDto,
  ) {
    await this.groupsService.assertOwnerOrAdmin(groupId, requesterId);

    const invitation = await this.memberModel.findOne({
      _id: invitationId,
      groupId: new Types.ObjectId(groupId),
      status: 'pending',
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    if (dto.action === 'approved') {
      // Check group capacity before approving
      const group = await this.groupModel.findById(groupId).lean();
      if (group) {
        const approvedCount = await this.memberModel.countDocuments({
          groupId: new Types.ObjectId(groupId),
          status: 'approved',
        });
        if (approvedCount >= group.maxPlayers) {
          throw new BadRequestException('Group is full');
        }
      }

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
    if (existing)
      throw new ConflictException('Already a member or request pending');

    // Joining by code/QR is a REQUEST, not an instant join: an owner/admin must
    // approve it, exactly like requestToJoin. The invite code identifies which
    // group to ask about; it does not itself grant entry.
    //
    // No capacity check here on purpose — respond() enforces it at approval
    // time. Checking now would reject a valid request against a group that may
    // have space by the time it is reviewed, while still not bounding the number
    // of approvals.
    //
    // `joinedAt` is deliberately left unset: it means "when they actually
    // joined" and is stamped by respond() on approval.
    await this.memberModel.create({
      groupId: group._id,
      userId: new Types.ObjectId(userId),
      role: 'member',
      status: 'pending',
    });

    return {
      message: 'Join request sent. Waiting for approval.',
      groupId: group._id,
      status: 'pending',
    };
  }
}
