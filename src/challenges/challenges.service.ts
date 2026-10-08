// src/challenges/challenges.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { RespondChallengeDto } from './dto/respond-challenge.dto';
import { Challenge, ChallengeDocument } from './schemas/challenge.schema';

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(
    @InjectModel(Challenge.name)
    private challengeModel: Model<ChallengeDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Group A's owner/admin challenges group B.
   *
   * One PENDING challenge per pair at a time, in either direction — a second
   * "we challenge you" while the first sits unanswered is noise, and the
   * answer to the first settles both. A rematch after accept/reject is a new
   * challenge; `eventId` keeps each occasion's match attached to its row.
   */
  async create(userId: string, dto: CreateChallengeDto) {
    if (dto.challengerGroupId === dto.challengedGroupId) {
      throw new BadRequestException('A group cannot challenge itself');
    }

    const [challenger, challenged] = await Promise.all([
      this.groupModel.findById(dto.challengerGroupId).select('name').lean(),
      this.groupModel.findById(dto.challengedGroupId).select('name').lean(),
    ]);
    if (!challenger) throw new NotFoundException('Challenger group not found');
    if (!challenged) throw new NotFoundException('Challenged group not found');

    await this.assertGroupAdmin(
      dto.challengerGroupId,
      userId,
      'Only an owner/admin of the challenger group can issue a challenge',
    );

    const pending = await this.challengeModel.exists({
      status: 'proposed',
      $or: [
        {
          challengerGroupId: new Types.ObjectId(dto.challengerGroupId),
          challengedGroupId: new Types.ObjectId(dto.challengedGroupId),
        },
        {
          challengerGroupId: new Types.ObjectId(dto.challengedGroupId),
          challengedGroupId: new Types.ObjectId(dto.challengerGroupId),
        },
      ],
    });
    if (pending) {
      throw new BadRequestException(
        'There is already a pending challenge between these groups',
      );
    }

    const challenge = await this.challengeModel.create({
      challengerGroupId: new Types.ObjectId(dto.challengerGroupId),
      challengedGroupId: new Types.ObjectId(dto.challengedGroupId),
      createdBy: new Types.ObjectId(userId),
    });

    await this.notifyGroupAdmins(
      dto.challengedGroupId,
      'New challenge',
      `'${challenger.name}' has challenged your group to a match`,
    );

    return challenge;
  }

  /**
   * The challenged side answers. Reason is optional even on reject.
   * Only a still-`proposed` challenge can be answered — the verdict is the
   * end of the handshake, not a toggle.
   */
  async respond(challengeId: string, userId: string, dto: RespondChallengeDto) {
    const challenge = await this.findOrThrow(challengeId);
    if (challenge.status !== 'proposed') {
      throw new BadRequestException(
        `This challenge has already been ${challenge.status}`,
      );
    }

    await this.assertGroupAdmin(
      challenge.challengedGroupId.toString(),
      userId,
      'Only an owner/admin of the challenged group can respond',
    );

    challenge.status = dto.action === 'accept' ? 'accepted' : 'rejected';
    challenge.rejectReason =
      dto.action === 'reject' ? (dto.reason ?? null) : null;
    challenge.respondedBy = new Types.ObjectId(userId);
    challenge.respondedAt = new Date();
    await challenge.save();

    const challenged = await this.groupModel
      .findById(challenge.challengedGroupId)
      .select('name')
      .lean();
    await this.notifyGroupAdmins(
      challenge.challengerGroupId.toString(),
      dto.action === 'accept' ? 'Challenge accepted' : 'Challenge rejected',
      dto.action === 'accept'
        ? `'${challenged?.name}' accepted your challenge — propose the match event`
        : `'${challenged?.name}' rejected your challenge` +
            (dto.reason ? `: ${dto.reason}` : ''),
    );

    return challenge;
  }

  /**
   * A group's challenges, both directions, newest first. Approved members
   * only — the handshake is group business, not public.
   */
  async listForGroup(groupId: string, userId: string) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new BadRequestException('groupId must be a valid id');
    }
    const gid = new Types.ObjectId(groupId);

    const member = await this.memberModel.findOne({
      groupId: gid,
      userId: new Types.ObjectId(userId),
      status: 'approved',
    });
    if (!member) {
      throw new ForbiddenException('Not a member of this group');
    }

    return this.challengeModel
      .find({ $or: [{ challengerGroupId: gid }, { challengedGroupId: gid }] })
      .populate('challengerGroupId', 'name logo')
      .populate('challengedGroupId', 'name logo')
      .sort({ createdAt: -1 })
      .lean();
  }

  async findOrThrow(challengeId: string): Promise<ChallengeDocument> {
    if (!Types.ObjectId.isValid(challengeId)) {
      throw new NotFoundException('Challenge not found');
    }
    const challenge = await this.challengeModel.findById(challengeId);
    if (!challenge) throw new NotFoundException('Challenge not found');
    return challenge;
  }

  /** Owner/admin membership gate, with a caller-specific message. */
  private async assertGroupAdmin(
    groupId: string,
    userId: string,
    message: string,
  ) {
    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
      role: { $in: ['owner', 'admin'] },
    });
    if (!member) throw new ForbiddenException(message);
  }

  /** Best-effort notification to every owner/admin of a group. */
  private async notifyGroupAdmins(
    groupId: string,
    title: string,
    body: string,
  ) {
    try {
      const admins = await this.memberModel
        .find({
          groupId: new Types.ObjectId(groupId),
          status: 'approved',
          role: { $in: ['owner', 'admin'] },
        })
        .select('userId')
        .lean();
      await Promise.all(
        admins.map((admin) =>
          this.notificationsService.create({
            userId: admin.userId.toString(),
            title,
            body,
            type: 'group',
            refId: groupId,
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`Challenge notification failed: ${err}`);
    }
  }
}
