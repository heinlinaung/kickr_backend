// src/awards/awards.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from '../events/schemas/event-player.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  clampLimit,
  decodeCursor,
  keysetFilter,
  toPage,
} from '../common/pagination/cursor';
import { Award, AwardDocument, AwardType } from './schemas/award.schema';
import {
  AwardMemory,
  AwardMemoryDocument,
} from './schemas/award-memory.schema';
import { awardError } from './awards.errors';

/** The bits of an event the award writers need — a document or a lean row. */
export interface AwardEventRef {
  _id: Types.ObjectId | string;
  title: string;
}

/** Mongo's duplicate-key error, raised by the unique award/memory indexes. */
function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

/**
 * Awards (spec: Awards): MVP for one player of one event, Group Challenge
 * for the group that won a challenge, and memories — a group award a member
 * chose to show on their own profile.
 *
 * Event authority (organizer, roster, lifecycle window) is checked by
 * EventsService before it calls in here: EventsModule imports this module,
 * so this one reads events through schemas only and never back.
 */
@Injectable()
export class AwardsService {
  private readonly logger = new Logger(AwardsService.name);

  constructor(
    @InjectModel(Award.name) private awardModel: Model<AwardDocument>,
    @InjectModel(AwardMemory.name)
    private memoryModel: Model<AwardMemoryDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // --- MVP ------------------------------------------------------------------

  /**
   * Give (or re-confirm) the event's MVP award.
   *
   * One MVP per event. Naming the same player again only updates the note.
   * Naming a different one is `MVP_ALREADY_AWARDED` unless `replace` is set —
   * the legacy `POST /events/:id/mvp` has always let the organizer correct
   * the MVP in one call, and keeps doing so; the awards endpoint makes them
   * take it back first.
   *
   * The recipient is notified only when the award is new to them.
   */
  async giveMvp(params: {
    event: AwardEventRef;
    userId: string;
    awardedBy: string;
    note?: string | null;
    replace?: boolean;
  }) {
    const eventId = new Types.ObjectId(String(params.event._id));
    const existing = await this.awardModel.findOne({ type: 'MVP', eventId });

    if (existing && existing.recipientId.toString() === params.userId) {
      if (params.note !== undefined) {
        existing.note = params.note;
        await existing.save();
      }
      return this.toMvpView(existing);
    }

    if (existing) {
      if (!params.replace) {
        throw awardError(
          'MVP_ALREADY_AWARDED',
          'This event already has an MVP — take it back before naming another player',
        );
      }
      await this.awardModel.deleteOne({ _id: existing._id });
    }

    let award: AwardDocument;
    try {
      award = await this.awardModel.create({
        type: 'MVP',
        recipientKind: 'USER',
        recipientId: new Types.ObjectId(params.userId),
        eventId,
        title: `MVP – ${params.event.title}`,
        note: params.note ?? null,
        eventTitle: params.event.title,
        awardedBy: new Types.ObjectId(params.awardedBy),
        awardedAt: new Date(),
      });
    } catch (err) {
      // Two organizers naming different MVPs at once: the index lets one win.
      if (isDuplicateKey(err)) {
        throw awardError(
          'MVP_ALREADY_AWARDED',
          'This event already has an MVP — take it back before naming another player',
        );
      }
      throw err;
    }

    try {
      await this.notificationsService.notifyUsers([params.userId], {
        title: 'You are the MVP!',
        body: `You were named MVP of ${params.event.title}`,
        type: 'event',
        refId: eventId.toString(),
      });
    } catch (err) {
      this.logger.warn(`MVP notification failed: ${err}`);
    }

    return this.toMvpView(award);
  }

  /** The event's MVP award, or null when none has been given. */
  async getMvp(eventId: string) {
    const award = await this.awardModel.findOne({
      type: 'MVP',
      eventId: new Types.ObjectId(eventId),
    });
    return award ? this.toMvpView(award) : null;
  }

  /** Take back the event's MVP. `AWARD_NOT_FOUND` when there is none. */
  async revokeMvp(eventId: string) {
    const result = await this.awardModel.deleteOne({
      type: 'MVP',
      eventId: new Types.ObjectId(eventId),
    });
    if (result.deletedCount === 0) {
      throw awardError('AWARD_NOT_FOUND', 'This event has no MVP award');
    }
  }

  // --- Group Challenge -------------------------------------------------------

  /**
   * The system's Group Challenge award, given when a challenge match is
   * final with a winner. Idempotent: the unique index on `challengeId` turns
   * a second call into a no-op, so a retried `done` never double-awards.
   *
   * Eligible for the memory = the winning side's joined players who are
   * approved members of the winning group right now — frozen onto the award.
   * Every eligible player is notified.
   */
  async giveChallengeAward(params: {
    event: AwardEventRef;
    challengeId: Types.ObjectId | string;
    winnerGroupId: Types.ObjectId | string;
  }) {
    const challengeId = new Types.ObjectId(String(params.challengeId));
    const groupId = new Types.ObjectId(String(params.winnerGroupId));
    const eventId = new Types.ObjectId(String(params.event._id));

    if (
      await this.awardModel.exists({ type: 'GROUP_CHALLENGE', challengeId })
    ) {
      return null;
    }

    const group = await this.groupModel.findById(groupId).select('name').lean();
    const sideRows = await this.playerModel
      .find({ eventId, groupId, status: 'joined' })
      .select('userId')
      .lean();
    const sideIds = sideRows.flatMap((row) => (row.userId ? [row.userId] : []));
    const members = sideIds.length
      ? await this.memberModel
          .find({ groupId, userId: { $in: sideIds }, status: 'approved' })
          .select('userId')
          .lean()
      : [];
    const eligibleUserIds = members.map((m) => m.userId);

    let award: AwardDocument;
    try {
      award = await this.awardModel.create({
        type: 'GROUP_CHALLENGE',
        recipientKind: 'GROUP',
        recipientId: groupId,
        eventId,
        challengeId,
        title: `${params.event.title} – Winner`,
        eventTitle: params.event.title,
        groupName: group?.name ?? null,
        awardedBy: null,
        awardedAt: new Date(),
        eligibleUserIds,
      });
    } catch (err) {
      if (isDuplicateKey(err)) return null;
      throw err;
    }

    try {
      await this.notificationsService.notifyUsers(eligibleUserIds.map(String), {
        title: 'Challenge won!',
        body:
          `${group?.name ?? 'Your group'} won ${params.event.title} — ` +
          'add the award to your profile',
        type: 'group',
        refId: groupId.toString(),
      });
    } catch (err) {
      this.logger.warn(`Challenge award notification failed: ${err}`);
    }

    return award;
  }

  // --- Reads -----------------------------------------------------------------

  /**
   * A player's Awards tab: their own MVP awards plus the group awards they
   * added as memories, newest first, one keyset-paged list.
   *
   * Gated like the profile summary: a missing, deleted or private account is
   * a 404, except to the user themselves.
   */
  async listForUser(
    targetUserId: string,
    callerId: string,
    query: { type?: AwardType; limit?: number; cursor?: string },
  ) {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new NotFoundException('User not found');
    }
    const uid = new Types.ObjectId(targetUserId);
    const user = await this.userModel
      .findById(uid)
      .select('privacy deletedAt')
      .lean();
    if (!user || (user as any).deletedAt) {
      throw new NotFoundException('User not found');
    }
    if (
      targetUserId !== callerId &&
      (user as any).privacy?.profileVisibility === 'private'
    ) {
      throw new NotFoundException('Profile is private');
    }

    // A player has a handful of memories at most — one per challenge their
    // group won — so resolving them up front keeps the page a single query.
    const memories = await this.memoryModel
      .find({ userId: uid })
      .select('awardId')
      .lean();
    const memoryByAward = new Map(
      memories.map((m) => [m.awardId.toString(), m._id.toString()]),
    );

    const arms: Record<string, unknown>[] = [];
    if (query.type !== 'GROUP_CHALLENGE') {
      arms.push({ type: 'MVP', recipientKind: 'USER', recipientId: uid });
    }
    if (query.type !== 'MVP' && memories.length) {
      arms.push({ _id: { $in: memories.map((m) => m.awardId) } });
    }

    const limit = clampLimit(query.limit ?? NaN);
    if (!arms.length) return { items: [], nextCursor: null, hasMore: false };

    const filter: Record<string, unknown> = { $or: arms };
    if (query.cursor) {
      filter.$and = [keysetFilter(decodeCursor(query.cursor), 'awardedAt', -1)];
    }

    const rows = await this.awardModel
      .find(filter)
      .sort({ awardedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const page = toPage(rows, limit, (row) => ({
      d: row.awardedAt.toISOString(),
      i: row._id.toString(),
    }));
    const groupNames = await this.liveGroupNames(page.items);

    return {
      ...page,
      items: page.items.map((row) => {
        if (row.type === 'MVP') {
          return {
            id: row._id.toString(),
            type: row.type,
            source: 'OWN',
            title: row.title,
            note: row.note ?? null,
            event: row.eventId
              ? { id: row.eventId.toString(), title: row.eventTitle }
              : null,
            awardedAt: row.awardedAt,
          };
        }
        const groupId = row.recipientId.toString();
        return {
          id: row._id.toString(),
          type: row.type,
          source: 'MEMORY',
          memoryId: memoryByAward.get(row._id.toString()) ?? null,
          title: row.title,
          group: {
            id: groupId,
            // Live name while the group exists, the snapshot once it is gone.
            name: groupNames.get(groupId) ?? row.groupName,
            deleted: !groupNames.has(groupId),
          },
          awardedAt: row.awardedAt,
        };
      }),
    };
  }

  /**
   * A group's Awards tab: its Group Challenge awards, newest first, with
   * `canAddAsMemory` for the caller. Approved members only.
   */
  async listForGroup(
    groupId: string,
    callerId: string,
    query: { limit?: number; cursor?: string },
  ) {
    const gid = this.parseId(groupId);
    const group = await this.groupModel.findById(gid).select('name').lean();
    if (!group) throw new NotFoundException('Group not found');
    await this.assertMember(gid, callerId);

    const limit = clampLimit(query.limit ?? NaN);
    const filter: Record<string, unknown> = {
      type: 'GROUP_CHALLENGE',
      recipientKind: 'GROUP',
      recipientId: gid,
    };
    if (query.cursor) {
      Object.assign(
        filter,
        keysetFilter(decodeCursor(query.cursor), 'awardedAt', -1),
      );
    }

    const rows = await this.awardModel
      .find(filter)
      .sort({ awardedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = toPage(rows, limit, (row) => ({
      d: row.awardedAt.toISOString(),
      i: row._id.toString(),
    }));

    const mine = await this.memoryModel
      .find({
        userId: new Types.ObjectId(callerId),
        awardId: { $in: page.items.map((row) => row._id) },
      })
      .select('awardId')
      .lean();
    const memoryByAward = new Map(
      mine.map((m) => [m.awardId.toString(), m._id.toString()]),
    );

    return {
      ...page,
      items: page.items.map((row) => {
        const memoryId = memoryByAward.get(row._id.toString()) ?? null;
        return {
          id: row._id.toString(),
          type: row.type,
          title: row.title,
          challenge: row.challengeId
            ? { id: row.challengeId.toString(), title: row.eventTitle }
            : null,
          event: row.eventId
            ? { id: row.eventId.toString(), title: row.eventTitle }
            : null,
          awardedAt: row.awardedAt,
          memoryId,
          canAddAsMemory:
            !memoryId && this.isEligible(row.eligibleUserIds, callerId),
        };
      }),
    };
  }

  // --- Memories ----------------------------------------------------------------

  /**
   * Add a group award to the caller's profile. Eligible = on the frozen
   * eligibility list (a member of the group when it was awarded AND a player
   * on the winning side). No current-membership check: leaving the group
   * does not take away a win the player was part of.
   */
  async addMemory(groupId: string, awardId: string, callerId: string) {
    if (!Types.ObjectId.isValid(groupId) || !Types.ObjectId.isValid(awardId)) {
      throw awardError('AWARD_NOT_FOUND', 'Award not found');
    }
    const award = await this.awardModel
      .findOne({
        _id: new Types.ObjectId(awardId),
        type: 'GROUP_CHALLENGE',
        recipientId: new Types.ObjectId(groupId),
      })
      .select('eligibleUserIds')
      .lean();
    if (!award) throw awardError('AWARD_NOT_FOUND', 'Award not found');

    if (!this.isEligible(award.eligibleUserIds, callerId)) {
      throw awardError(
        'NOT_ELIGIBLE_FOR_MEMORY',
        'Only members who played in this challenge for the group can add this award',
      );
    }

    try {
      const memory = await this.memoryModel.create({
        awardId: award._id,
        userId: new Types.ObjectId(callerId),
      });
      return { memoryId: memory._id.toString(), awardId };
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw awardError(
          'MEMORY_EXISTS',
          'This award is already on your profile',
        );
      }
      throw err;
    }
  }

  /** Remove a memory from the caller's own profile. The award is untouched. */
  async removeMemory(memoryId: string, callerId: string) {
    if (!Types.ObjectId.isValid(memoryId)) {
      throw awardError('MEMORY_NOT_FOUND', 'Memory not found');
    }
    // Scoped to the caller: someone else's memory id answers like a missing
    // one rather than confirming it exists.
    const result = await this.memoryModel.deleteOne({
      _id: new Types.ObjectId(memoryId),
      userId: new Types.ObjectId(callerId),
    });
    if (result.deletedCount === 0) {
      throw awardError('MEMORY_NOT_FOUND', 'Memory not found');
    }
  }

  // --- Helpers ---------------------------------------------------------------

  private toMvpView(award: AwardDocument) {
    return {
      id: award._id.toString(),
      type: award.type,
      recipient: {
        kind: award.recipientKind,
        id: award.recipientId.toString(),
      },
      eventId: award.eventId?.toString() ?? null,
      title: award.title,
      note: award.note,
      awardedBy: award.awardedBy?.toString() ?? 'system',
      awardedAt: award.awardedAt,
    };
  }

  private isEligible(eligible: Types.ObjectId[] | undefined, userId: string) {
    return (eligible ?? []).some((id) => id.toString() === userId);
  }

  /** Current names of the page's still-existing groups. */
  private async liveGroupNames(
    rows: { type: string; recipientId: Types.ObjectId }[],
  ): Promise<Map<string, string>> {
    const ids = rows
      .filter((row) => row.type === 'GROUP_CHALLENGE')
      .map((row) => row.recipientId);
    if (!ids.length) return new Map();
    const groups = await this.groupModel
      .find({ _id: { $in: ids } })
      .select('name')
      .lean();
    return new Map(groups.map((g) => [g._id.toString(), g.name]));
  }

  private async assertMember(groupId: Types.ObjectId, userId: string) {
    const member = await this.memberModel.exists({
      groupId,
      userId: new Types.ObjectId(userId),
      status: 'approved',
    });
    if (!member) {
      throw awardError('NOT_GROUP_MEMBER', 'Not a member of this group');
    }
  }

  private parseId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Group not found');
    }
    return new Types.ObjectId(id);
  }
}
