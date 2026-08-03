import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from '../events/schemas/event-player.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

/** Why a given user id was not added. */
export type SkipReason =
  | 'already_a_member'
  | 'already_joined'
  | 'user_not_found'
  | 'group_full'
  | 'event_full';

export interface BulkAddResult {
  added: string[];
  skipped: { userId: string; reason: SkipReason }[];
  addedCount: number;
  skippedCount: number;
}

/**
 * Support/back-office operations behind AdminKeyGuard.
 *
 * These bypass PERMISSION checks (owner approval, role gates, event lifecycle
 * state) but deliberately preserve DATA INTEGRITY: the target must exist, users
 * must be real, duplicates are skipped, and capacity is respected. Overfilling
 * an event would break the derived `isFull` and downstream team shuffling.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async addGroupMembers(
    groupId: string,
    userIds: string[],
  ): Promise<BulkAddResult> {
    const group = await this.groupModel.findById(groupId).lean();
    if (!group) throw new NotFoundException('Group not found');

    const ids = dedupe(userIds);
    const known = await this.existingUserIds(ids);
    const result = emptyResult();

    let approvedCount = await this.memberModel.countDocuments({
      groupId: new Types.ObjectId(groupId),
      status: 'approved',
    });

    for (const userId of ids) {
      if (!known.has(userId)) {
        result.skipped.push({ userId, reason: 'user_not_found' });
        continue;
      }

      const existing = await this.memberModel.findOne({
        groupId: new Types.ObjectId(groupId),
        userId: new Types.ObjectId(userId),
      });
      if (existing) {
        // Covers both approved members and still-pending requests.
        result.skipped.push({ userId, reason: 'already_a_member' });
        continue;
      }

      if (approvedCount >= group.maxPlayers) {
        result.skipped.push({ userId, reason: 'group_full' });
        continue;
      }

      await this.memberModel.create({
        groupId: new Types.ObjectId(groupId),
        userId: new Types.ObjectId(userId),
        role: 'member',
        // Force-added members are approved outright — that is the point of the
        // endpoint. Matches exactly what owner approval produces.
        status: 'approved',
        joinedAt: new Date(),
      });
      approvedCount++;
      result.added.push(userId);
    }

    return finalise(result);
  }

  async addEventPlayers(
    eventId: string,
    userIds: string[],
  ): Promise<BulkAddResult> {
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) throw new NotFoundException('Event not found');

    const ids = dedupe(userIds);
    const known = await this.existingUserIds(ids);
    const result = emptyResult();

    for (const userId of ids) {
      if (!known.has(userId)) {
        result.skipped.push({ userId, reason: 'user_not_found' });
        continue;
      }

      const existing = await this.playerModel.findOne({
        eventId: new Types.ObjectId(eventId),
        userId: new Types.ObjectId(userId),
      });
      if (existing && existing.status === 'joined') {
        result.skipped.push({ userId, reason: 'already_joined' });
        continue;
      }

      // Same atomic capacity guard the normal join path uses, so joinedCount
      // can never drift from the real EventPlayer count. The lifecycle-state
      // condition is intentionally absent — that is the permission bypass.
      const claimed = await this.eventModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(eventId),
          $expr: { $lt: ['$joinedCount', '$maxPlayers'] },
        },
        { $inc: { joinedCount: 1 } },
        { new: true },
      );
      if (!claimed) {
        result.skipped.push({ userId, reason: 'event_full' });
        continue;
      }

      if (existing) {
        // Reactivate a previously cancelled row rather than inserting a
        // duplicate — the {eventId,userId} index is unique.
        existing.status = 'joined';
        existing.joinedAt = new Date();
        await existing.save();
      } else {
        await this.playerModel.create({
          eventId: new Types.ObjectId(eventId),
          userId: new Types.ObjectId(userId),
          joinedAt: new Date(),
          status: 'joined',
        });
      }
      result.added.push(userId);
    }

    return finalise(result);
  }

  /** One query for the whole batch rather than a findById per id. */
  private async existingUserIds(ids: string[]): Promise<Set<string>> {
    const rows = await this.userModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('_id')
      .lean();
    return new Set(rows.map((r) => r._id.toString()));
  }
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function emptyResult(): BulkAddResult {
  return { added: [], skipped: [], addedCount: 0, skippedCount: 0 };
}

function finalise(r: BulkAddResult): BulkAddResult {
  r.addedCount = r.added.length;
  r.skippedCount = r.skipped.length;
  return r;
}
