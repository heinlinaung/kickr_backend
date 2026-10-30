import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from '../events/schemas/event-player.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  clampLimit,
  decodeCursor,
  keysetFilter,
  toPage,
} from '../common/pagination/cursor';
import { Friendship, FriendshipDocument } from './schemas/friendship.schema';
import {
  EventInvitation,
  EventInvitationDocument,
  EventInvitationStatus,
} from './schemas/event-invitation.schema';
import { FriendErrorCode, friendError } from './friends.errors';
import {
  assertWithinDailyLimit,
  DAILY_INVITATION_LIMIT,
  eventStartsAt,
  isDuplicateKey,
  isEventOpen,
  pairKeyOf,
} from './friends.helpers';
import { CreateEventInvitationsDto } from './dto/create-event-invitations.dto';

export type InvitationListStatus = 'pending' | 'accepted' | 'declined';

type InviteResult =
  | { userId: string; status: 'INVITED'; invitationId: string }
  | { userId: string; status: 'FAILED'; error: { code: FriendErrorCode } };

/**
 * Friends inviting friends to events. A confirmed friendship is the only
 * thing an invitation needs — group membership is never checked, so this is
 * how someone outside a group gets onto one of its events.
 */
@Injectable()
export class EventInvitationsService {
  constructor(
    @InjectModel(EventInvitation.name)
    private invitationModel: Model<EventInvitationDocument>,
    @InjectModel(Friendship.name)
    private friendshipModel: Model<FriendshipDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * `POST /events/:eventId/invitations`.
   *
   * Event-level checks (1-3) fail the whole call. Per-user checks (4-7) run
   * for each invitee in order and stop at that invitee's first failure, so
   * one bad id does not sink the rest of the batch.
   */
  async invite(
    callerId: string,
    eventId: string,
    dto: CreateEventInvitationsDto,
  ) {
    const event = Types.ObjectId.isValid(eventId)
      ? await this.eventModel
          .findById(eventId)
          .select(
            'title type status date startTime maxPlayers joinedCount createdBy',
          )
          .lean()
      : null;
    if (!event) throw friendError('EVENT_NOT_FOUND', 'Event not found');

    const me = new Types.ObjectId(callerId);
    const takesPart =
      event.createdBy.equals(me) ||
      !!(await this.playerModel.exists({
        eventId: event._id,
        userId: me,
        status: 'joined',
      }));
    if (!takesPart) {
      throw friendError(
        'NOT_EVENT_PARTICIPANT',
        'Only players and the organizer of this event can invite to it',
      );
    }
    if (!isEventOpen(event)) {
      throw friendError(
        'EVENT_CLOSED',
        'This event is no longer taking new players',
      );
    }

    const userIds = [...new Set(dto.userIds)];
    await assertWithinDailyLimit(
      this.invitationModel,
      { inviterId: me },
      DAILY_INVITATION_LIMIT,
      userIds.length,
      'event invitations',
    );

    const oids = userIds.map((id) => new Types.ObjectId(id));
    const [friendRows, joined, pending] = await Promise.all([
      this.friendshipModel
        .find({
          pairKey: { $in: userIds.map((id) => pairKeyOf(callerId, id)) },
          status: 'ACCEPTED',
        })
        .select('pairKey')
        .lean(),
      this.playerModel.distinct('userId', {
        eventId: event._id,
        userId: { $in: oids },
        status: 'joined',
      }),
      this.invitationModel.distinct('inviteeId', {
        eventId: event._id,
        inviteeId: { $in: oids },
        status: 'PENDING',
      }),
    ]);
    const friendKeys = new Set(friendRows.map((r) => r.pairKey));
    const joinedSet = new Set(joined.map(String));
    const pendingSet = new Set(pending.map(String));
    const isFull =
      event.maxPlayers != null && (event.joinedCount ?? 0) >= event.maxPlayers;

    const results: InviteResult[] = [];
    const invited: string[] = [];
    for (const userId of userIds) {
      const code: FriendErrorCode | null = !friendKeys.has(
        pairKeyOf(callerId, userId),
      )
        ? 'NOT_FRIENDS'
        : joinedSet.has(userId)
          ? 'ALREADY_PARTICIPANT'
          : pendingSet.has(userId)
            ? 'INVITATION_EXISTS'
            : isFull
              ? 'EVENT_FULL'
              : null;
      if (code) {
        results.push({ userId, status: 'FAILED', error: { code } });
        continue;
      }
      try {
        const row = await this.invitationModel.create({
          eventId: event._id,
          inviterId: me,
          inviteeId: new Types.ObjectId(userId),
          message: dto.message ?? null,
          status: 'PENDING',
        });
        results.push({
          userId,
          status: 'INVITED',
          invitationId: row._id.toString(),
        });
        invited.push(userId);
      } catch (err) {
        // Someone else invited them to this event a moment ago.
        if (!isDuplicateKey(err)) throw err;
        results.push({
          userId,
          status: 'FAILED',
          error: { code: 'INVITATION_EXISTS' },
        });
      }
    }

    if (invited.length) {
      const inviter = await this.userModel
        .findById(me)
        .select('name displayName')
        .lean();
      const inviterName = inviter?.displayName || inviter?.name || 'A friend';
      await this.notifications.notifyUsers(invited, {
        title: 'Event invitation',
        body: `${inviterName} invited you to '${event.title}'`,
        type: 'event',
        refId: event._id.toString(),
      });
    }

    return { results };
  }

  /** `GET /invitations` — invitations the caller received, newest first. */
  async listReceived(
    callerId: string,
    query: { status: InvitationListStatus; limit?: number; cursor?: string },
  ) {
    const me = new Types.ObjectId(callerId);
    await this.expireClosed(me);

    const filter: Record<string, unknown> = {
      inviteeId: me,
      status: query.status.toUpperCase(),
    };
    if (query.cursor) {
      Object.assign(
        filter,
        keysetFilter(decodeCursor(query.cursor), 'createdAt', -1),
      );
    }
    const limit = clampLimit(query.limit ?? NaN);
    const rows = await this.invitationModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = toPage(rows, limit, (row) => ({
      d: row.createdAt!.toISOString(),
      i: row._id.toString(),
    }));

    const [events, inviters] = await Promise.all([
      this.eventModel
        .find({ _id: { $in: page.items.map((r) => r.eventId) } })
        .select('title date startTime groupId')
        .lean(),
      this.userModel
        .find({ _id: { $in: page.items.map((r) => r.inviterId) } })
        .select('name displayName')
        .lean(),
    ]);
    const groups = await this.groupModel
      .find({ _id: { $in: events.map((e) => e.groupId).filter(Boolean) } })
      .select('name')
      .lean();
    const eventById = new Map(events.map((e) => [e._id.toString(), e]));
    const inviterById = new Map(inviters.map((u) => [u._id.toString(), u]));
    const groupNameById = new Map(
      groups.map((g) => [g._id.toString(), g.name]),
    );

    return {
      ...page,
      items: page.items.map((row) => {
        // The invitee sees this summary even when they are not in the group.
        const event = eventById.get(row.eventId.toString());
        const inviter = inviterById.get(row.inviterId.toString());
        return {
          id: row._id.toString(),
          event: event
            ? {
                id: event._id.toString(),
                title: event.title,
                startsAt: eventStartsAt(event),
                groupName: event.groupId
                  ? (groupNameById.get(event.groupId.toString()) ?? null)
                  : null,
              }
            : null,
          inviter: {
            id: row.inviterId.toString(),
            displayName: inviter?.displayName || inviter?.name || null,
          },
          message: row.message ?? null,
          status: row.status,
          createdAt: row.createdAt,
        };
      }),
    };
  }

  /**
   * `POST /invitations/:invitationId/accept` — puts the invitee on the roster.
   *
   * The seat is taken first with the same atomic capacity guard as
   * `EventsService.join`, then the invitation is claimed; if the claim loses a
   * race the seat is handed back. That order means a failed accept never
   * leaves the invitation in a state it has to be rolled back from.
   */
  async accept(callerId: string, invitationId: string) {
    const invitation = await this.findReceived(invitationId, callerId);
    const event = await this.eventModel.findById(invitation.eventId).lean();
    if (!event || !isEventOpen(event)) {
      await this.setStatus(invitation._id, 'EXPIRED');
      throw friendError(
        'EVENT_CLOSED',
        'This event is no longer taking new players',
      );
    }

    const me = new Types.ObjectId(callerId);
    const existing = await this.playerModel.findOne({
      eventId: event._id,
      userId: me,
    });
    // Joined on their own since being invited — nothing left to add.
    if (existing?.status === 'joined') {
      await this.claim(invitation._id);
      return this.accepted(invitation._id, event._id);
    }

    const seated = await this.eventModel.findOneAndUpdate(
      {
        _id: event._id,
        status: 'join',
        $expr: {
          $or: [
            // A null cap means the event is never full.
            { $eq: [{ $ifNull: ['$maxPlayers', null] }, null] },
            { $lt: ['$joinedCount', '$maxPlayers'] },
          ],
        },
      },
      { $inc: { joinedCount: 1 } },
      { new: true },
    );
    if (!seated) {
      const fresh = await this.eventModel.findById(event._id).lean();
      if (!fresh || !isEventOpen(fresh)) {
        await this.setStatus(invitation._id, 'EXPIRED');
        throw friendError(
          'EVENT_CLOSED',
          'This event is no longer taking new players',
        );
      }
      // Left PENDING: a spot may open up, and the invitee can try again.
      throw friendError('EVENT_FULL', 'This event is full');
    }

    try {
      await this.claim(invitation._id);
      if (existing) {
        existing.status = 'joined';
        existing.joinedAt = new Date();
        await existing.save();
      } else {
        await this.playerModel.create({
          eventId: event._id,
          userId: me,
          joinedAt: new Date(),
          status: 'joined',
        });
      }
    } catch (err) {
      await this.eventModel.updateOne(
        { _id: event._id, joinedCount: { $gt: 0 } },
        { $inc: { joinedCount: -1 } },
      );
      // A concurrent self-join created the roster row first: they are in.
      if (isDuplicateKey(err)) return this.accepted(invitation._id, event._id);
      throw err;
    }

    return this.accepted(invitation._id, event._id);
  }

  /** `POST /invitations/:invitationId/decline`. The inviter is not told. */
  async decline(callerId: string, invitationId: string) {
    const invitation = await this.findReceived(invitationId, callerId);
    const updated = await this.setStatus(invitation._id, 'DECLINED');
    if (!updated) throw this.notPending();
    return { id: invitation._id.toString(), status: 'DECLINED' };
  }

  /** `DELETE /invitations/:invitationId` — the inviter withdraws it. */
  async revoke(callerId: string, invitationId: string) {
    const invitation = Types.ObjectId.isValid(invitationId)
      ? await this.invitationModel.findById(invitationId).lean()
      : null;
    if (
      !invitation ||
      (invitation.inviterId.toString() !== callerId &&
        invitation.inviteeId.toString() !== callerId)
    ) {
      throw friendError('INVITATION_NOT_FOUND', 'Invitation not found');
    }
    if (invitation.inviterId.toString() !== callerId) {
      throw friendError(
        'NOT_INVITATION_OWNER',
        'Only the user who sent this invitation can revoke it',
      );
    }
    const updated = await this.setStatus(invitation._id, 'REVOKED');
    if (!updated) throw this.notPending();
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Marks the caller's pending invitations to events that have closed —
   * started, ended, cancelled or deleted — as `EXPIRED`. Done lazily when the
   * invitee reads their list, so the events lifecycle needs no hook into this
   * module.
   */
  private async expireClosed(inviteeId: Types.ObjectId) {
    const eventIds: Types.ObjectId[] = await this.invitationModel.distinct(
      'eventId',
      { inviteeId, status: 'PENDING' },
    );
    if (!eventIds.length) return;

    const events = await this.eventModel
      .find({ _id: { $in: eventIds } })
      .select('type status date startTime')
      .lean();
    const now = new Date();
    const open = new Set(
      events.filter((e) => isEventOpen(e, now)).map((e) => e._id.toString()),
    );
    const closed = eventIds.filter((id) => !open.has(id.toString()));
    if (!closed.length) return;

    await this.invitationModel.updateMany(
      { inviteeId, status: 'PENDING', eventId: { $in: closed } },
      { $set: { status: 'EXPIRED', respondedAt: now } },
    );
  }

  /**
   * A PENDING invitation addressed to the caller. Anyone else's id reads as
   * not found, so invitation ids cannot be probed.
   */
  private async findReceived(invitationId: string, callerId: string) {
    const invitation = Types.ObjectId.isValid(invitationId)
      ? await this.invitationModel.findById(invitationId).lean()
      : null;
    if (!invitation || invitation.inviteeId.toString() !== callerId) {
      throw friendError('INVITATION_NOT_FOUND', 'Invitation not found');
    }
    if (invitation.status !== 'PENDING') throw this.notPending();
    return invitation;
  }

  /** PENDING → `status`, atomically; null if it had already left PENDING. */
  private setStatus(id: Types.ObjectId, status: EventInvitationStatus) {
    return this.invitationModel.findOneAndUpdate(
      { _id: id, status: 'PENDING' },
      { $set: { status, respondedAt: new Date() } },
      { new: true },
    );
  }

  private async claim(id: Types.ObjectId) {
    if (!(await this.setStatus(id, 'ACCEPTED'))) throw this.notPending();
  }

  private accepted(id: Types.ObjectId, eventId: Types.ObjectId) {
    return {
      id: id.toString(),
      status: 'ACCEPTED',
      eventId: eventId.toString(),
    };
  }

  private notPending() {
    return friendError(
      'INVITATION_NOT_PENDING',
      'This invitation was already answered, revoked or expired',
    );
  }
}
