import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from '../events/schemas/event-player.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Award, AwardDocument } from '../awards/schemas/award.schema';
import {
  AwardMemory,
  AwardMemoryDocument,
} from '../awards/schemas/award-memory.schema';
import { AwardsService } from '../awards/awards.service';
import {
  clampLimit,
  decodeCursor,
  keysetFilter,
  toPage,
} from '../common/pagination/cursor';
import {
  Friendship,
  FriendshipDocument,
  FriendshipStatus,
} from './schemas/friendship.schema';
import {
  EventInvitation,
  EventInvitationDocument,
} from './schemas/event-invitation.schema';
import { friendError } from './friends.errors';
import {
  assertWithinDailyLimit,
  DAILY_FRIEND_REQUEST_LIMIT,
  escapeRegex,
  eventStartsAt,
  isDuplicateKey,
  isEventOpen,
  pairKeyOf,
  REJECTION_COOLDOWN_MS,
  userSummary,
} from './friends.helpers';

export type FriendRequestDirection = 'incoming' | 'outgoing';
export type FriendEventStatus = 'upcoming' | 'past' | 'all';
export type FriendEventRole = 'participant' | 'organizer';

/** Card fields loaded for another user — never email, phone or devices. */
const SUMMARY_FIELDS = 'name displayName profileImage';

/**
 * Cursor for the friend list, which sorts by name rather than by date, so the
 * shared `CursorPayload` (date + id) does not fit. Same contract: opaque
 * base64url JSON, validated as untrusted input.
 */
function encodeNameCursor(n: string, i: string): string {
  return Buffer.from(JSON.stringify({ n, i })).toString('base64url');
}

function decodeNameCursor(cursor: string): { n: string; i: Types.ObjectId } {
  try {
    const { n, i } = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    if (
      typeof n === 'string' &&
      typeof i === 'string' &&
      Types.ObjectId.isValid(i)
    ) {
      return { n, i: new Types.ObjectId(i) };
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor');
}

@Injectable()
export class FriendsService {
  constructor(
    @InjectModel(Friendship.name)
    private friendshipModel: Model<FriendshipDocument>,
    @InjectModel(EventInvitation.name)
    private invitationModel: Model<EventInvitationDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    @InjectModel(Award.name) private awardModel: Model<AwardDocument>,
    @InjectModel(AwardMemory.name)
    private memoryModel: Model<AwardMemoryDocument>,
    private readonly awardsService: AwardsService,
  ) {}

  // --- Friend requests -------------------------------------------------------

  /**
   * `POST /friend-requests`. Returns `created: false` when the addressee had
   * already asked the caller: both requests resolve into one friendship at
   * once, and the controller answers 200 instead of 201.
   */
  async sendRequest(callerId: string, toUserId: string) {
    if (toUserId === callerId) {
      throw friendError('CANNOT_FRIEND_SELF', 'You cannot befriend yourself');
    }
    const target = Types.ObjectId.isValid(toUserId)
      ? await this.userModel.findById(toUserId).select('deletedAt').lean()
      : null;
    if (!target || target.deletedAt) {
      throw friendError('USER_NOT_FOUND', 'User not found');
    }

    const me = new Types.ObjectId(callerId);
    const them = new Types.ObjectId(toUserId);
    const pairKey = pairKeyOf(callerId, toUserId);

    const live = await this.friendshipModel.findOne({ pairKey, active: true });
    if (live?.status === 'ACCEPTED') {
      throw friendError('ALREADY_FRIENDS', 'You are already friends');
    }
    if (live && live.requesterId.equals(them)) {
      // They asked first — asking back is an answer, not a second request.
      const accepted = await this.friendshipModel
        .findOneAndUpdate(
          { _id: live._id, status: 'PENDING' },
          { $set: { status: 'ACCEPTED', respondedAt: new Date() } },
          { new: true },
        )
        .lean();
      if (!accepted) {
        throw friendError(
          'REQUEST_NOT_PENDING',
          'Their request changed while you were answering — try again',
        );
      }
      return { created: false, friendship: this.toFriendshipView(accepted) };
    }
    if (live) {
      throw friendError(
        'REQUEST_ALREADY_EXISTS',
        'You already have a pending request to this user',
      );
    }

    const recentRejection = await this.friendshipModel.exists({
      requesterId: me,
      addresseeId: them,
      status: 'REJECTED',
      respondedAt: { $gt: new Date(Date.now() - REJECTION_COOLDOWN_MS) },
    });
    if (recentRejection) {
      throw friendError(
        'REQUEST_ALREADY_EXISTS',
        'You cannot send this user another request yet',
      );
    }

    await assertWithinDailyLimit(
      this.friendshipModel,
      { requesterId: me },
      DAILY_FRIEND_REQUEST_LIMIT,
      1,
      'friend requests',
    );

    try {
      const row = await this.friendshipModel.create({
        requesterId: me,
        addresseeId: them,
        pairKey,
        status: 'PENDING',
        active: true,
      });
      return { created: true, friendship: this.toFriendshipView(row) };
    } catch (err) {
      // Both users sent at the same moment; the unique pair index let one in.
      if (isDuplicateKey(err)) {
        throw friendError(
          'REQUEST_ALREADY_EXISTS',
          'A request between you two already exists',
        );
      }
      throw err;
    }
  }

  /** `GET /friend-requests` — pending requests to or from the caller. */
  async listRequests(
    callerId: string,
    direction: FriendRequestDirection,
    query: { limit?: number; cursor?: string },
  ) {
    const me = new Types.ObjectId(callerId);
    const mine = direction === 'incoming' ? 'addresseeId' : 'requesterId';
    const other = direction === 'incoming' ? 'requesterId' : 'addresseeId';

    const filter: Record<string, unknown> = { [mine]: me, status: 'PENDING' };
    if (query.cursor) {
      Object.assign(
        filter,
        keysetFilter(decodeCursor(query.cursor), 'createdAt', -1),
      );
    }
    const limit = clampLimit(query.limit ?? NaN);
    const rows = await this.friendshipModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = toPage(rows, limit, (row) => ({
      d: row.createdAt!.toISOString(),
      i: row._id.toString(),
    }));

    const users = await this.userModel
      .find({ _id: { $in: page.items.map((r) => r[other]) } })
      .select(SUMMARY_FIELDS)
      .lean();
    const byId = new Map(users.map((u) => [u._id.toString(), u]));

    return {
      ...page,
      items: page.items.map((row) => {
        const user = byId.get(row[other].toString());
        return {
          id: row._id.toString(),
          user: user
            ? userSummary(user)
            : { id: row[other].toString(), displayName: null, avatarUrl: null },
          createdAt: row.createdAt,
        };
      }),
    };
  }

  /** `POST /friend-requests/:requestId/approve` and `/reject`. */
  async respondToRequest(
    callerId: string,
    requestId: string,
    answer: Extract<FriendshipStatus, 'ACCEPTED' | 'REJECTED'>,
  ) {
    const request = await this.findRequest(requestId, callerId);
    if (request.addresseeId.toString() !== callerId) {
      throw friendError(
        'NOT_REQUEST_ADDRESSEE',
        'Only the user who received this request can answer it',
      );
    }
    const updated = await this.friendshipModel
      .findOneAndUpdate(
        { _id: request._id, status: 'PENDING' },
        {
          $set: {
            status: answer,
            respondedAt: new Date(),
            active: answer === 'ACCEPTED',
          },
        },
        { new: true },
      )
      .lean();
    if (!updated) {
      throw friendError(
        'REQUEST_NOT_PENDING',
        'This request was already answered or cancelled',
      );
    }
    return this.toFriendshipView(updated);
  }

  /** `DELETE /friend-requests/:requestId` — the requester withdraws it. */
  async cancelRequest(callerId: string, requestId: string) {
    const request = await this.findRequest(requestId, callerId);
    if (request.requesterId.toString() !== callerId) {
      throw friendError(
        'NOT_REQUEST_OWNER',
        'Only the user who sent this request can cancel it',
      );
    }
    const updated = await this.friendshipModel.findOneAndUpdate(
      { _id: request._id, status: 'PENDING' },
      {
        $set: { status: 'CANCELLED', respondedAt: new Date(), active: false },
      },
    );
    if (!updated) {
      throw friendError(
        'REQUEST_NOT_PENDING',
        'This request was already answered or cancelled',
      );
    }
  }

  // --- Friends ---------------------------------------------------------------

  /** `GET /friends` — accepted friends, sorted by display name. */
  async listFriends(
    callerId: string,
    query: { q?: string; limit?: number; cursor?: string },
  ) {
    const me = new Types.ObjectId(callerId);
    const rows = await this.friendshipModel
      .find({
        status: 'ACCEPTED',
        $or: [{ requesterId: me }, { addresseeId: me }],
      })
      .select('requesterId addresseeId respondedAt createdAt')
      .lean();
    const sinceById = new Map(
      rows.map((r) => [
        this.otherSide(r, callerId).toString(),
        r.respondedAt ?? r.createdAt,
      ]),
    );
    if (!sinceById.size) return { items: [], nextCursor: null, hasMore: false };

    const match: Record<string, unknown> = {
      _id: { $in: [...sinceById.keys()].map((id) => new Types.ObjectId(id)) },
      deletedAt: null,
    };
    const term = (query.q ?? '').trim();
    if (term) {
      const rx = new RegExp(escapeRegex(term), 'i');
      match.$or = [{ name: rx }, { displayName: rx }, { username: rx }];
    }

    const limit = clampLimit(query.limit ?? NaN);
    const after = query.cursor ? decodeNameCursor(query.cursor) : null;
    const users = await this.userModel.aggregate<{
      _id: Types.ObjectId;
      name?: string;
      displayName?: string;
      profileImage?: string;
      sortName: string;
    }>([
      { $match: match },
      {
        $addFields: {
          // displayName when set (and not blank), else the account name —
          // the same fallback the card shows.
          sortName: {
            $toLower: {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ['$displayName', ''] } }, 0] },
                '$displayName',
                { $ifNull: ['$name', ''] },
              ],
            },
          },
        },
      },
      ...(after
        ? [
            {
              $match: {
                $or: [
                  { sortName: { $gt: after.n } },
                  { sortName: after.n, _id: { $gt: after.i } },
                ],
              },
            },
          ]
        : []),
      { $sort: { sortName: 1, _id: 1 } },
      { $limit: limit + 1 },
      { $project: { name: 1, displayName: 1, profileImage: 1, sortName: 1 } },
    ]);

    const hasMore = users.length > limit;
    const items = hasMore ? users.slice(0, limit) : users;
    const last = items[items.length - 1];
    return {
      items: items.map((u) => ({
        ...userSummary(u),
        friendsSince: sinceById.get(u._id.toString()) ?? null,
      })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeNameCursor(last.sortName, last._id.toString())
          : null,
    };
  }

  /**
   * `DELETE /friends/:userId`. Pending invitations between the two, in either
   * direction, are revoked; events either of them already joined stay joined.
   */
  async unfriend(callerId: string, userId: string) {
    const removed = await this.friendshipModel.findOneAndDelete({
      pairKey: pairKeyOf(callerId, userId),
      status: 'ACCEPTED',
    });
    if (!removed) {
      throw friendError('NOT_FRIENDS', 'You are not friends with this user');
    }

    const me = new Types.ObjectId(callerId);
    const them = new Types.ObjectId(userId);
    await this.invitationModel.updateMany(
      {
        status: 'PENDING',
        $or: [
          { inviterId: me, inviteeId: them },
          { inviterId: them, inviteeId: me },
        ],
      },
      { $set: { status: 'REVOKED', respondedAt: new Date() } },
    );
  }

  /** The accepted friendship between two users, or `NOT_FRIENDS`. */
  async assertFriends(callerId: string, userId: string) {
    const friendship = await this.friendshipModel
      .findOne({ pairKey: pairKeyOf(callerId, userId), status: 'ACCEPTED' })
      .lean();
    if (!friendship) {
      throw friendError('NOT_FRIENDS', 'You are not friends with this user');
    }
    return friendship;
  }

  // --- Friend details --------------------------------------------------------

  /**
   * `GET /friends/:userId`. Privacy settings still apply between friends: a
   * `private` profile shows only the identity card, and `showStats: false`
   * hides the counts. `members` visibility is open to friends.
   */
  async getFriendProfile(callerId: string, userId: string) {
    const friendship = await this.assertFriends(callerId, userId);
    const user = await this.userModel
      .findById(userId)
      .select(`${SUMMARY_FIELDS} biography privacy deletedAt`)
      .lean();
    if (!user || user.deletedAt) {
      throw friendError('USER_NOT_FOUND', 'User not found');
    }

    const profile: Record<string, unknown> = {
      ...userSummary(user),
      friendsSince: friendship.respondedAt ?? friendship.createdAt,
    };
    const privacy = user.privacy ?? {
      profileVisibility: 'public',
      showStats: true,
      showMatchHistory: true,
    };
    if (privacy.profileVisibility === 'private') return profile;

    profile.bio = user.biography ?? null;
    if (privacy.showStats !== false) {
      const uid = new Types.ObjectId(userId);
      const [eventsJoined, mvpAwards, memories] = await Promise.all([
        this.playerModel.countDocuments({ userId: uid, status: 'joined' }),
        this.awardModel.countDocuments({
          type: 'MVP',
          recipientKind: 'USER',
          recipientId: uid,
        }),
        this.memoryModel.countDocuments({ userId: uid }),
      ]);
      profile.stats = { eventsJoined, awards: mvpAwards + memories };
    }
    return profile;
  }

  /**
   * `GET /friends/:userId/awards` — the friend's Awards tab, in the same shape
   * as `GET /users/:userId/awards`, behind the friendship check.
   */
  async getFriendAwards(
    callerId: string,
    userId: string,
    query: { limit?: number; cursor?: string },
  ) {
    await this.assertFriends(callerId, userId);
    return this.awardsService.listForUser(userId, callerId, query);
  }

  /**
   * `GET /friends/:userId/events` — events the friend joined or organized.
   *
   * Visibility follows the group event list: the caller sees an event they
   * are on themselves, any event of a group they are an approved member of,
   * and otherwise only `isPublic` events outside private groups.
   */
  async getFriendEvents(
    callerId: string,
    userId: string,
    query: {
      status: FriendEventStatus;
      role?: FriendEventRole;
      limit?: number;
      cursor?: string;
    },
  ) {
    await this.assertFriends(callerId, userId);
    const friend = new Types.ObjectId(userId);
    const me = new Types.ObjectId(callerId);

    const [friendJoined, myJoined, myGroups] = await Promise.all([
      this.playerModel.distinct('eventId', {
        userId: friend,
        status: 'joined',
      }),
      this.playerModel.distinct('eventId', { userId: me, status: 'joined' }),
      this.memberModel.distinct('groupId', { userId: me, status: 'approved' }),
    ]);

    const roleArm =
      query.role === 'organizer'
        ? { createdBy: friend }
        : query.role === 'participant'
          ? { _id: { $in: friendJoined } }
          : { $or: [{ createdBy: friend }, { _id: { $in: friendJoined } }] };

    const candidateGroups = await this.eventModel.distinct('groupId', roleArm);
    const privateGroups = await this.groupModel.distinct('_id', {
      _id: { $in: candidateGroups.filter(Boolean) },
      isPrivate: true,
    });

    const and: Record<string, unknown>[] = [
      roleArm,
      {
        $or: [
          { createdBy: me },
          { _id: { $in: myJoined } },
          { groupId: { $in: myGroups } },
          { isPublic: true, groupId: { $nin: privateGroups } },
        ],
      },
    ];

    const now = new Date();
    if (query.status === 'upcoming') and.push({ date: { $gte: now } });
    if (query.status === 'past') and.push({ date: { $lt: now } });
    // Upcoming reads soonest first; past and all read most recent first.
    const direction = query.status === 'upcoming' ? 1 : -1;
    if (query.cursor) {
      and.push(keysetFilter(decodeCursor(query.cursor), 'date', direction));
    }

    const limit = clampLimit(query.limit ?? NaN);
    const rows = await this.eventModel
      .find({ $and: and })
      .select('title date startTime groupId createdBy status type')
      .sort({ date: direction, _id: direction })
      .limit(limit + 1)
      .lean();
    const page = toPage(rows, limit, (row) => ({
      d: row.date.toISOString(),
      i: row._id.toString(),
    }));

    const myJoinedSet = new Set(myJoined.map(String));
    return {
      ...page,
      items: page.items.map((event) => {
        const id = event._id.toString();
        const callerTakesPart =
          event.createdBy.equals(me) || myJoinedSet.has(id);
        return {
          id,
          title: event.title,
          startsAt: eventStartsAt(event),
          status: event.status,
          groupId: event.groupId?.toString() ?? null,
          role:
            query.role ??
            (event.createdBy.equals(friend) ? 'organizer' : 'participant'),
          // Whether the CALLER can invite friends to it right now.
          canInvite: callerTakesPart && isEventOpen(event, now),
        };
      }),
    };
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Loads a request the caller is a party to. Anyone else gets
   * `REQUEST_NOT_FOUND`, so request ids cannot be probed.
   */
  private async findRequest(requestId: string, callerId: string) {
    const request = Types.ObjectId.isValid(requestId)
      ? await this.friendshipModel.findById(requestId).lean()
      : null;
    if (
      !request ||
      (request.requesterId.toString() !== callerId &&
        request.addresseeId.toString() !== callerId)
    ) {
      throw friendError('REQUEST_NOT_FOUND', 'Friend request not found');
    }
    return request;
  }

  private otherSide(
    row: { requesterId: Types.ObjectId; addresseeId: Types.ObjectId },
    callerId: string,
  ): Types.ObjectId {
    return row.requesterId.toString() === callerId
      ? row.addresseeId
      : row.requesterId;
  }

  private toFriendshipView(row: {
    _id: Types.ObjectId;
    requesterId: Types.ObjectId;
    addresseeId: Types.ObjectId;
    status: string;
    createdAt?: Date;
    respondedAt?: Date | null;
  }) {
    return {
      id: row._id.toString(),
      requesterId: row.requesterId.toString(),
      addresseeId: row.addresseeId.toString(),
      status: row.status,
      createdAt: row.createdAt,
      respondedAt: row.respondedAt ?? null,
    };
  }
}
