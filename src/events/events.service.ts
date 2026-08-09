import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Event, EventDocument } from './schemas/event.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from './schemas/event-player.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { LocationsService } from '../locations/locations.service';
import {
  EventStatus,
  canJoin,
  canLeave,
  canModify,
  canTransition,
  isEventStatus,
} from './events.lifecycle';

@Injectable()
export class EventsService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    @InjectModel(Group.name)
    private groupModel: Model<GroupDocument>,
    private readonly locationsService: LocationsService,
  ) {}

  /**
   * Loads an event and asserts the caller may act as its organizer.
   *
   * Organizer = the event's `createdBy`, or an approved owner/admin of the
   * owning group for group events. Spec §4.1 calls for one shared helper here;
   * ShuffleService duplicated this check before, and every new lifecycle route
   * would have duplicated it again.
   *
   * Returns the event so callers don't re-fetch it.
   */
  async assertOrganizer(
    eventId: string,
    userId: string,
  ): Promise<EventDocument> {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');

    if (event.groupId) {
      const member = await this.memberModel.findOne({
        groupId: event.groupId,
        userId: new Types.ObjectId(userId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      // The creator keeps control even if they later lose their group role.
      if (!member && event.createdBy.toString() !== userId) {
        throw new ForbiddenException(
          'Only the event creator or a group owner/admin can manage this event',
        );
      }
    } else if (event.createdBy.toString() !== userId) {
      throw new ForbiddenException('Only the event creator can manage this event');
    }

    return event;
  }

  /**
   * Public event listing.
   *
   * `region` filters by the owning GROUP's country or city — one value matches
   * either granularity, so callers holding "Myanmar" or "Yangon" both work
   * without knowing which they have. Events with no groupId are excluded when
   * region is set: they have no group from which to derive a region.
   */
  async list(userId: string, region?: string) {
    const filter: Record<string, unknown> = { isPublic: true };

    if (region?.trim()) {
      const rx = new RegExp(`^${escapeRegex(region.trim())}$`, 'i');
      const groups = await this.groupModel
        .find({ $or: [{ country: rx }, { city: rx }] })
        .select('_id')
        .lean();

      // No matching group means no matching events — return early rather than
      // issuing a $in against an empty array.
      if (!groups.length) return [];
      filter.groupId = { $in: groups.map((g) => g._id) };
    }

    const events = await this.eventModel.find(filter).sort({ date: 1 }).lean();
    return events.map(withIsFull);
  }

  /**
   * Every event belonging to one group, soonest first.
   *
   * Visibility: an **approved** member of the group sees all of its events,
   * public or private. Anyone else sees only the public ones — the group's
   * existence isn't secret, but its private fixtures are.
   *
   * This is why the endpoint lives here rather than as a `groupId` filter on
   * `GET /events`: that route hard-filters `isPublic: true`, so a private
   * group event could never appear there.
   *
   * `status` optionally narrows to one lifecycle state (e.g. only `join`
   * events for a "what can I sign up for" screen).
   */
  async listByGroup(groupId: string, userId: string, status?: string) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new BadRequestException('Invalid group id');
    }

    const group = await this.groupModel.findById(groupId).select('_id').lean();
    if (!group) throw new NotFoundException('Group not found');

    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
    });

    const filter: Record<string, unknown> = {
      groupId: new Types.ObjectId(groupId),
    };
    if (!member) filter.isPublic = true;

    if (status !== undefined) {
      if (!isEventStatus(status)) {
        throw new BadRequestException(`Unknown status '${status}'`);
      }
      filter.status = status;
    }

    const events = await this.eventModel.find(filter).sort({ date: 1 }).lean();
    return events.map(withIsFull);
  }

  async create(userId: string, dto: CreateEventDto): Promise<EventDocument> {
    if (dto.groupId) {
      const member = await this.memberModel.findOne({
        groupId: new Types.ObjectId(dto.groupId),
        userId: new Types.ObjectId(userId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      if (!member)
        throw new ForbiddenException(
          'Only group owner or admin can create events',
        );
    }
    // Destructure locationId out so the raw string is never spread onto the
    // model (Mongoose's loose create() typing would not flag the mismatch).
    const { locationId, ...rest } = dto;
    if (locationId) {
      // assertCanEdit, not assertOwnedBy: a group's owner/admin/captain may
      // attach the group's own ground even if someone else created the row
      // (spec §4.6). assertOwnedBy rejected exactly that case.
      await this.locationsService.assertCanEdit(locationId, userId);
    }
    return this.eventModel.create({
      ...rest,
      date: new Date(dto.date),
      groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : null,
      locationId: locationId ? new Types.ObjectId(locationId) : null,
      createdBy: new Types.ObjectId(userId),
    });
  }

  /**
   * Event detail, with the owning group's rules attached.
   *
   * `groupRules` is a read-only projection — the rules live on the Group and are
   * edited via PATCH /groups/:id. Always an array (never null) so the
   * client can render it unconditionally; `[]` for events with no group.
   */
  async findById(eventId: string) {
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) throw new NotFoundException('Event not found');

    let groupRules: string[] = [];
    if (event.groupId) {
      const group = await this.groupModel
        .findById(event.groupId)
        .select('rules')
        .lean();
      groupRules = (group as { rules?: string[] } | null)?.rules ?? [];
    }

    return { ...withIsFull(event), groupRules };
  }

  async join(eventId: string, userId: string) {
    // Check existing player record first
    const existing = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
    });
    if (existing && existing.status === 'joined')
      throw new ConflictException('Already joined');

    // Atomic capacity check: only increment while registration is open and
    // there is room. Unchanged from the pre-lifecycle version except that the
    // status condition is now 'join' — the race guard is the $expr, not the
    // read above.
    const updatedEvent = await this.eventModel.findOneAndUpdate(
      {
        _id: eventId,
        status: 'join',
        $expr: { $lt: ['$joinedCount', '$maxPlayers'] },
      },
      { $inc: { joinedCount: 1 } },
      { new: true },
    );
    if (!updatedEvent) {
      const event = await this.eventModel.findById(eventId).lean();
      if (!event) throw new NotFoundException('Event not found');
      throw new BadRequestException(
        !canJoin(event.status)
          ? 'Event is not open for joining'
          : 'Event is full',
      );
    }

    // Create or reactivate player record
    if (existing && existing.status === 'cancelled') {
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

    // No status flip at capacity: `full` is gone and `isFull` is derived from
    // joinedCount >= maxPlayers on read.
    return { message: 'Joined event successfully' };
  }

  async leave(eventId: string, userId: string) {
    // Gate on the lifecycle BEFORE touching the player row: once teams are
    // being assigned, a silent departure would leave the fixtures wrong.
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) throw new NotFoundException('Event not found');
    if (!canLeave(event.status)) {
      throw new BadRequestException(
        'Registration has closed for this event; ask the organizer to reopen it',
      );
    }

    const player = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
      status: 'joined',
    });
    if (!player) throw new NotFoundException('You have not joined this event');

    player.status = 'cancelled';
    await player.save();

    // Decrement only. There is no status to reopen now that `full` is gone,
    // and the $gt guard keeps a double-leave from driving the count negative.
    await this.eventModel.findOneAndUpdate(
      { _id: eventId, status: 'join', joinedCount: { $gt: 0 } },
      { $inc: { joinedCount: -1 } },
    );

    return { message: 'Left event successfully' };
  }

  /**
   * Advance the lifecycle. Organizer-gated and validated against the pure
   * transition table — every rejection path is exercised in the unit tests.
   */
  async setStatus(eventId: string, userId: string, to: string) {
    const event = await this.assertOrganizer(eventId, userId);

    if (!isEventStatus(to)) {
      throw new BadRequestException(`Unknown status '${to}'`);
    }
    if (!canTransition(event.status, to)) {
      throw new ConflictException(
        `Cannot move an event from '${event.status}' to '${to}'`,
      );
    }

    event.status = to as EventStatus;
    await event.save();

    // TODO(step 2): archiving team chats on `done` lands with EventTeamChat.
    return event.toJSON();
  }

  /** Edit an event. Organizer-gated; rejected once archived. */
  async update(eventId: string, userId: string, dto: UpdateEventDto) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canModify(event.status)) {
      throw new BadRequestException('A completed event can no longer be edited');
    }

    const { locationId, date, startTime, endTime } = dto;
    if (locationId) {
      // assertCanEdit (not assertOwnedBy) so a group's admin can attach the
      // group's own ground — see spec §4.6.
      await this.locationsService.assertCanEdit(locationId, userId);
    }

    // Copy an explicit allow-list rather than spreading the DTO. The global
    // ValidationPipe already strips unknown keys, but `status` must never be
    // settable here regardless of pipe config: the lifecycle moves only
    // through setStatus, where the transition table applies.
    const EDITABLE = [
      'title',
      'description',
      'isPublic',
      'maxPlayers',
      'teamCount',
      'sportType',
      'skillLevel',
      'price',
    ] as const;
    for (const key of EDITABLE) {
      if (dto[key] !== undefined) (event as any)[key] = dto[key];
    }

    if (date) event.date = new Date(date);
    if (startTime !== undefined) {
      event.startTime = startTime ? new Date(startTime) : null;
    }
    if (endTime !== undefined) {
      event.endTime = endTime ? new Date(endTime) : null;
    }
    if (locationId !== undefined) {
      event.locationId = locationId ? new Types.ObjectId(locationId) : null;
    }
    await event.save();
    return event.toJSON();
  }

  /**
   * Delete an event. Organizer-gated and rejected once archived, so completed
   * events stay available as history (spec §4.1 / parent §4.5 "Done").
   *
   * Hard delete, per the spec's stated assumption — open question #1 asks
   * whether joined events should instead soft-cancel with notifications.
   */
  async remove(eventId: string, userId: string) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canModify(event.status)) {
      throw new BadRequestException('A completed event can no longer be deleted');
    }

    await this.playerModel.deleteMany({ eventId: new Types.ObjectId(eventId) });
    await this.eventModel.deleteOne({ _id: new Types.ObjectId(eventId) });
    return { message: 'Event deleted successfully' };
  }

  async listPlayers(eventId: string) {
    return this.playerModel
      .find({ eventId: new Types.ObjectId(eventId), status: 'joined' })
      .populate('userId', 'name profileImage')
      .lean();
  }
}

/**
 * Attaches the derived `isFull` flag to a lean event row.
 *
 * The schema declares `isFull` as a virtual, but virtuals are absent from
 * `.lean()` results — and every read path here is lean for speed. Rather than
 * drop lean(), compute the same rule in one place.
 */
function withIsFull<T extends { joinedCount?: number; maxPlayers?: number }>(
  event: T,
): T & { isFull: boolean } {
  return {
    ...event,
    isFull: (event.joinedCount ?? 0) >= (event.maxPlayers ?? 0),
  };
}

/** Escapes user input so it can be embedded in a RegExp literally. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
