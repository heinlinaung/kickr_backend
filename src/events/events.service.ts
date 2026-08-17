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
  EventMatch,
  EventMatchDocument,
} from './schemas/event-match.schema';
import {
  EventTeamChat,
  EventTeamChatDocument,
} from './schemas/event-team-chat.schema';
import { EventLike, EventLikeDocument } from './schemas/event-like.schema';
import {
  EventTemplate,
  EventTemplateDocument,
} from './schemas/event-template.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { Location, LocationDocument } from '../locations/schemas/location.schema';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { GenerateTeamsDto } from './dto/generate-teams.dto';
import { AssignTeamPlayersDto } from './dto/assign-team-players.dto';
import { UpdateMatchScoreDto } from './dto/update-match-score.dto';
import { SubmitResultDto } from './dto/submit-result.dto';
import { CreateEventTemplateDto } from './dto/create-event-template.dto';
import { LocationsService } from '../locations/locations.service';
import { ImageKitService } from '../common/upload/imagekit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  EventStatus,
  canEnterScore,
  canJoin,
  canLeave,
  canModify,
  canShuffle,
  canSubmitResult,
  canTransition,
  isEventStatus,
} from './events.lifecycle';
import { Team, TeamDocument } from './schemas/team.schema';
import {
  MATCH_BUFFER_MINUTES,
  MIN_TEAMS,
  TEAM_COLOURS,
  computeStandings,
  dealIntoTeams,
  generateFixturesLimited,
  matchCountFor,
  shuffled,
} from './events.fixtures';

/** Default geo radius when `near` is given without an explicit `radius`. */
const DEFAULT_RADIUS_METRES = 10_000;

/**
 * Matches the bodyless `POST /shuffle` aims for when picking a match duration.
 * Only a default — `POST /teams/generate` takes an explicit duration.
 */
const DEFAULT_SHUFFLE_MATCHES = 3;

/** Filters accepted by `GET /events` (spec §6). */
export interface ListEventsQuery {
  region?: string;
  /** "lat,lng" — swapped to GeoJSON [lng, lat] before querying. */
  near?: string;
  /** Metres; defaults to DEFAULT_RADIUS_METRES. */
  radius?: number;
  from?: string;
  to?: string;
  status?: string;
}

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
    @InjectModel(EventMatch.name)
    private matchModel: Model<EventMatchDocument>,
    @InjectModel(Team.name)
    private teamModel: Model<TeamDocument>,
    @InjectModel(EventTeamChat.name)
    private teamChatModel: Model<EventTeamChatDocument>,
    @InjectModel(EventLike.name)
    private likeModel: Model<EventLikeDocument>,
    @InjectModel(EventTemplate.name)
    private templateModel: Model<EventTemplateDocument>,
    @InjectModel(Location.name)
    private locationModel: Model<LocationDocument>,
    private readonly locationsService: LocationsService,
    private readonly imagekit: ImageKitService,
    private readonly notificationsService: NotificationsService,
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
  async list(userId: string, query: ListEventsQuery = {}) {
    const { region, near, radius, from, to, status } = query;
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

    if (status !== undefined) {
      if (!isEventStatus(status)) {
        throw new BadRequestException(`Unknown status '${status}'`);
      }
      filter.status = status;
    }

    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = new Date(from);
      if (to) range.$lte = new Date(to);
      filter.date = range;
    }

    // Geo narrowing runs as a separate lookup rather than a stage on the event
    // pipeline: $geoNear must be the FIRST stage of its aggregation (spec
    // §5.6), and events hold only a locationId — the coordinates live on
    // Location. So we start from locations, then filter events by the ids.
    if (near) {
      const locationIds = await this.locationIdsNear(near, radius);
      if (!locationIds.length) return [];
      filter.locationId = { $in: locationIds };
    }

    const events = await this.eventModel.find(filter).sort({ date: 1 }).lean();
    return events.map(withIsFull);
  }

  /**
   * Location ids within `radius` metres of `near`, nearest first.
   *
   * `near` is "lat,lng" as the client sends it; GeoJSON wants [lng, lat], so
   * the order is swapped here — getting this backwards is the classic geo bug
   * and silently returns results from the wrong hemisphere.
   */
  private async locationIdsNear(
    near: string,
    radius?: number,
  ): Promise<Types.ObjectId[]> {
    const parts = near.split(',').map((part) => Number(part.trim()));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
      throw new BadRequestException(
        "near must be 'lat,lng', e.g. near=16.8409,96.1735",
      );
    }
    const [lat, lng] = parts;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new BadRequestException('near is outside valid coordinate ranges');
    }

    const maxDistance = radius && radius > 0 ? radius : DEFAULT_RADIUS_METRES;
    const rows = await this.locationModel.aggregate<{ _id: Types.ObjectId }>([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distance',
          maxDistance,
          spherical: true,
        },
      },
      { $project: { _id: 1 } },
    ]);

    return rows.map((row) => row._id);
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
  async listByGroup(
    groupId: string,
    userId: string,
    status?: string,
    includeExpired = false,
  ) {
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

    // Hide expired events by default: a group screen is about what is coming
    // up, and past fixtures otherwise accumulate at the top of the list
    // forever. `done` is excluded regardless of date — an archived event is
    // finished even if its date has not passed. Pass includeExpired=true for
    // the history view.
    if (!includeExpired) {
      filter.date = { $gte: startOfToday() };
      // Only add the status exclusion when the caller has not pinned a status;
      // an explicit ?status=done must still return those events.
      if (status === undefined) filter.status = { $ne: 'done' };
    }

    const events = await this.eventModel.find(filter).sort({ date: 1 }).lean();
    return events.map(withIsFull);
  }

  /**
   * Every event the CALLER has joined, soonest first.
   *
   * Deliberately not derived from `GET /events`: that route hard-filters
   * `isPublic: true`, so a private group's event you joined would never appear.
   * Membership in the event is the only gate here — if you are on the roster,
   * you can see it, group member or not.
   *
   * Also distinct from the profile's `matchHistory`, which is newest-first,
   * carries a narrow projection, and is suppressed by
   * `privacy.showMatchHistory` — a privacy control that makes no sense applied
   * to your own list.
   */
  async listMine(
    userId: string,
    status?: string,
    includeExpired = false,
  ) {
    const rows = await this.playerModel
      .find({
        userId: new Types.ObjectId(userId),
        // A cancelled row survives for reactivation, so filter on the status
        // rather than mere presence — otherwise an event you left comes back.
        status: 'joined',
      })
      .select('eventId')
      .lean();

    // No $in against an empty array.
    if (!rows.length) return [];

    const filter: Record<string, unknown> = {
      _id: { $in: rows.map((row) => row.eventId) },
    };

    if (status !== undefined) {
      if (!isEventStatus(status)) {
        throw new BadRequestException(`Unknown status '${status}'`);
      }
      filter.status = status;
    }

    // Same rule as listByGroup, so the two lists agree on what "expired" means.
    if (!includeExpired) {
      filter.date = { $gte: startOfToday() };
      if (status === undefined) filter.status = { $ne: 'done' };
    }

    const events = await this.eventModel.find(filter).sort({ date: 1 }).lean();
    // joinedByMe is true by construction — every row here came from the
    // caller's own roster entries — but stated explicitly so a card rendered
    // from this list looks the same as one rendered from event detail.
    return events.map((event) => ({ ...withIsFull(event), joinedByMe: true }));
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
    const { locationId: dtoLocationId, templateId, ...rest } = dto;

    // A template fills fields the caller OMITTED — it never overrides what was
    // sent (spec §5.2). Applied before the location permission check so a
    // template-supplied ground is authorised the same as an explicit one.
    let locationId = dtoLocationId;
    if (templateId) {
      const template = await this.templateModel.findById(templateId).lean();
      if (!template) throw new NotFoundException('Template not found');
      if (template.ownerId.toString() !== userId) {
        throw new ForbiddenException('You can only use your own templates');
      }

      const FILLABLE = [
        'title',
        'description',
        'maxPlayers',
        'teamCount',
        'sportType',
        'skillLevel',
        'price',
        'isPublic',
      ] as const;
      const target = rest as Record<string, unknown>;
      for (const key of FILLABLE) {
        const fromTemplate = template[key];
        // Only fill what the caller omitted, and only from a field the
        // template actually set — a null column means "no default here".
        if (
          target[key] === undefined &&
          fromTemplate !== null &&
          fromTemplate !== undefined
        ) {
          target[key] = fromTemplate;
        }
      }
      if (!locationId && template.locationId) {
        locationId = template.locationId.toString();
      }
      if (!rest.groupId && template.groupId) {
        rest.groupId = template.groupId.toString();
      }
    }

    if (locationId) {
      // assertCanEdit, not assertOwnedBy: a group's owner/admin/captain may
      // attach the group's own ground even if someone else created the row
      // (spec §4.6). assertOwnedBy rejected exactly that case.
      await this.locationsService.assertCanEdit(locationId, userId);
    }
    return this.eventModel.create({
      ...rest,
      date: new Date(dto.date),
      startTime: dto.startTime ? new Date(dto.startTime) : null,
      endTime: dto.endTime ? new Date(dto.endTime) : null,
      groupId: rest.groupId ? new Types.ObjectId(rest.groupId) : null,
      locationId: locationId ? new Types.ObjectId(locationId) : null,
      templateId: templateId ? new Types.ObjectId(templateId) : null,
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
  async findById(eventId: string, userId?: string) {
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) throw new NotFoundException('Event not found');

    // `groupRules` is free text now (was string[]) — always a string, never
    // null, so the client can render it unconditionally.
    let groupRules = '';
    // The caller's role in the owning group, so the client can decide what to
    // show without a second call to the groups API. null for a non-member, and
    // for events with no group.
    let userRole: string | null = null;

    if (event.groupId) {
      const group = await this.groupModel
        .findById(event.groupId)
        .select('rules')
        .lean();
      groupRules = (group as { rules?: string } | null)?.rules ?? '';

      if (userId) {
        // Query the member row directly rather than via getMemberRole: that
        // helper filters to approved rows, so it cannot report a pending one.
        const member = await this.memberModel
          .findOne({
            groupId: event.groupId,
            userId: new Types.ObjectId(userId),
          })
          .select('role status')
          .lean();
        // Only an APPROVED member has an effective role; a pending request
        // stores role 'member' but confers nothing.
        userRole = member?.status === 'approved' ? (member.role ?? null) : null;
      }
    }

    // Location as an embedded object rather than a bare id, so a detail screen
    // renders the venue without a second request.
    const location = event.locationId
      ? await this.locationModel
          .findById(event.locationId)
          .select('name lat lng url address city country geo')
          .lean()
      : null;

    const teams = await this.teamModel
      .find({ eventId: event._id })
      .populate('players', 'name profileImage')
      .sort({ name: 1 })
      .lean();

    // Standings ride along on detail so the client renders the table without a
    // second round trip. Empty until fixtures exist, and derived either way.
    // Keyed off the loaded event's own _id rather than re-casting the caller's
    // string — that one is already known good, having just matched.
    const matches = await this.matchModel
      .find({ eventId: event._id })
      .sort({ matchNumber: 1 })
      .lean();
    const teamNames = [...new Set(matches.flatMap((m) => [m.teamA, m.teamB]))];

    let likedByMe = false;
    // Whether the CALLER is on the roster. `joinedCount` says how many people
    // joined, and `userRole` reports the caller's GROUP role — neither answers
    // "am I in?", so a group owner who never joined still showed `owner` with
    // no way to tell they were not playing.
    let joinedByMe = false;
    if (userId) {
      const [liked, player] = await Promise.all([
        this.likeModel.exists({
          // event._id, not a re-cast of the caller's string: the loaded
          // document's id is already known good.
          eventId: event._id,
          userId: new Types.ObjectId(userId),
        }),
        // status: 'joined' matters — a cancelled row still exists, and
        // reactivation reuses it, so its presence alone is not membership.
        this.playerModel.exists({
          eventId: event._id,
          userId: new Types.ObjectId(userId),
          status: 'joined',
        }),
      ]);
      likedByMe = !!liked;
      joinedByMe = !!player;
    }

    return {
      ...withIsFull(event),
      groupRules,
      // The caller's group role, so a detail screen can gate its own controls.
      userRole,
      // Resolved venue object; `locationId` stays for clients that only need it.
      location,
      teams,
      // Fixtures now live in their own collection, so detail attaches them
      // explicitly — the field is no longer on the event document.
      matches,
      standings: computeStandings(matches, teamNames),
      likedByMe,
      joinedByMe,
    };
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

    // Archive the team chats on the way into `done` (spec §4.1). Archived
    // rooms stay readable — this closes them to new messages, not to history.
    if (to === 'done') {
      await this.teamChatModel.updateMany(
        { eventId: event._id as Types.ObjectId },
        { $set: { archived: true } },
      );
    }

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
      'duration',
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

    // Fixtures, chats and likes live in their own collections now, so deleting
    // the event must take them with it or they are orphaned.
    await this.playerModel.deleteMany({ eventId: new Types.ObjectId(eventId) });
    await this.matchModel.deleteMany({ eventId: new Types.ObjectId(eventId) });
    await this.teamChatModel.deleteMany({
      eventId: new Types.ObjectId(eventId),
    });
    await this.likeModel.deleteMany({ eventId: new Types.ObjectId(eventId) });
    await this.eventModel.deleteOne({ _id: new Types.ObjectId(eventId) });
    return { message: 'Event deleted successfully' };
  }

  async listPlayers(eventId: string) {
    return this.playerModel
      .find({ eventId: new Types.ObjectId(eventId), status: 'joined' })
      .populate('userId', 'name profileImage')
      .lean();
  }

  // --- Step 2: teams, fixtures, scores, standings -------------------------

  /**
   * `PUT /events/:id/teams` — the client submits a finalized roster (§4.3.1).
   *
   * Validates, then hands off to the shared persistence path. PUT rather than
   * POST because the call replaces the whole assignment: the same body twice
   * leaves the same state.
   */
  async generateTeams(
    eventId: string,
    userId: string,
    dto: GenerateTeamsDto,
  ) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canShuffle(event.status)) {
      throw new BadRequestException(
        `Teams can only be generated during preparation (event is '${event.status}')`,
      );
    }

    // The whole point of taking `duration` here: the schedule has to fit the
    // booked slot, so refuse up front rather than persisting an empty fixture
    // list the organizer would have to debug.
    const matchCount = matchCountFor(event.duration, dto.duration);
    if (matchCount < 1) {
      throw new BadRequestException(
        `A ${dto.duration}-minute match does not fit in a ${event.duration}-minute ` +
          `event (${MATCH_BUFFER_MINUTES} minutes are reserved as buffer). ` +
          'Shorten the match duration or lengthen the event.',
      );
    }

    const eventObjectId = event._id as Types.ObjectId;
    const names = TEAM_COLOURS.slice(0, dto.teamsCount).map(String);

    // Replace wholesale: regenerating during `preparation` is legal, and
    // leaving the previous teams behind would strand players on teams that no
    // longer have fixtures.
    await this.teamModel.deleteMany({ eventId: eventObjectId });
    await this.playerModel.updateMany(
      { eventId: eventObjectId },
      { $set: { team: null } },
    );

    const teams = await this.teamModel.insertMany(
      names.map((name) => ({
        eventId: eventObjectId,
        groupId: event.groupId ?? null,
        name,
        players: [],
        duration: dto.duration,
        status: 'pending',
      })),
    );

    // Fixtures are derived now, from the team NAMES — assignment comes later and
    // does not change who plays whom.
    const fixtures = generateFixturesLimited(names, matchCount);
    await this.matchModel.deleteMany({ eventId: eventObjectId });
    const matches = await this.matchModel.insertMany(
      fixtures.map((fixture) => ({ ...fixture, eventId: eventObjectId })),
    );

    await Promise.all(
      names.map((team) =>
        this.teamChatModel.updateOne(
          { eventId: eventObjectId, team },
          { $setOnInsert: { eventId: eventObjectId, team, archived: false } },
          { upsert: true },
        ),
      ),
    );

    return {
      teams: teams.map((team) => team.toJSON()),
      matches: matches.map((match) => match.toJSON()),
      matchCount,
      // Stated explicitly so the client can show how the number was reached
      // rather than reverse-engineering it.
      schedule: {
        eventDuration: event.duration,
        bufferMinutes: MATCH_BUFFER_MINUTES,
        matchDuration: dto.duration,
        scheduledMinutes: matchCount * dto.duration,
      },
    };
  }

  /**
   * `PATCH /events/:id/teams/:teamId` — assign (or re-assign) one team's roster.
   *
   * Separate from generation because the client shuffles locally and the
   * organizer may hand-edit the result. Validated against the joined roster and
   * against the OTHER teams, so a player cannot end up in two teams — which
   * would corrupt standings and per-player stats.
   */
  async assignTeamPlayers(
    eventId: string,
    teamId: string,
    userId: string,
    dto: AssignTeamPlayersDto,
  ) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canShuffle(event.status)) {
      throw new BadRequestException(
        `Teams can only be edited during preparation (event is '${event.status}')`,
      );
    }
    if (!Types.ObjectId.isValid(teamId)) {
      throw new NotFoundException('Team not found');
    }

    const eventObjectId = event._id as Types.ObjectId;
    const team = await this.teamModel.findOne({
      _id: new Types.ObjectId(teamId),
      eventId: eventObjectId,
    });
    if (!team) throw new NotFoundException('Team not found');

    const joined = await this.joinedPlayerIds(eventId);
    const roster = dto.playerIds.map(String);

    const notJoined = roster.find((id) => !joined.includes(id));
    if (notJoined) {
      throw new BadRequestException(
        `Player ${notJoined} is not a joined player on this event`,
      );
    }
    const duplicate = roster.find((id, i) => roster.indexOf(id) !== i);
    if (duplicate) {
      throw new BadRequestException(
        `Player ${duplicate} is listed twice in this team`,
      );
    }

    // Check against sibling teams, not just this one.
    const others = await this.teamModel
      .find({ eventId: eventObjectId, _id: { $ne: team._id } })
      .lean();
    for (const other of others) {
      const clash = roster.find((id) =>
        (other.players ?? []).some((p) => p.toString() === id),
      );
      if (clash) {
        throw new BadRequestException(
          `Player ${clash} is already in ${other.name}`,
        );
      }
    }

    if (dto.name !== undefined) team.name = dto.name.trim();
    team.players = roster.map((id) => new Types.ObjectId(id));
    team.status = roster.length ? 'ready' : 'pending';
    await team.save();

    // Keep EventPlayer.team in step — it is what player-facing reads use.
    await this.playerModel.updateMany(
      { eventId: eventObjectId, team: team.name },
      { $set: { team: null } },
    );
    if (roster.length) {
      await this.playerModel.updateMany(
        {
          eventId: eventObjectId,
          userId: { $in: roster.map((id) => new Types.ObjectId(id)) },
        },
        { $set: { team: team.name } },
      );
      await Promise.all(
        roster.map((playerId) =>
          this.notificationsService.create({
            userId: playerId,
            title: 'Your team is set',
            body: `You are on ${team.name}. Check the fixtures for kick-off times.`,
            type: 'event',
            refId: eventObjectId.toString(),
          }),
        ),
      );
    }

    return team.toJSON();
  }

  /** Every team on an event, with players populated for display. */
  async listTeams(eventId: string) {
    const event = await this.eventModel.findById(eventId).select('_id').lean();
    if (!event) throw new NotFoundException('Event not found');

    return this.teamModel
      .find({ eventId: event._id })
      .populate('players', 'name profileImage')
      .sort({ name: 1 })
      .lean();
  }

  /**
   * Server-side colour shuffle — the optional fallback of §4.3.3.
   *
   * Now a convenience wrapper over the two-step flow: it generates the teams and
   * then deals the joined players across them, so a caller that wants the server
   * to decide still has a one-call path. Takes no body, so the team count comes
   * from the event and the match duration is derived from its duration.
   */
  async shuffleTeams(eventId: string, userId: string) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canShuffle(event.status)) {
      throw new BadRequestException(
        `Teams can only be shuffled during preparation (event is '${event.status}')`,
      );
    }

    const joined = await this.joinedPlayerIds(eventId);
    if (joined.length < MIN_TEAMS) {
      throw new BadRequestException(
        `At least ${MIN_TEAMS} joined players are needed to shuffle teams`,
      );
    }

    // Cap at the player count: dealing 3 players into 4 teams leaves an empty
    // team, and an empty team still appears in fixtures it can never play.
    const teamsCount = Math.max(
      MIN_TEAMS,
      Math.min(event.teamCount ?? 4, joined.length),
    );

    // No body to take a match duration from, so aim for DEFAULT_SHUFFLE_MATCHES
    // matches and let matchCountFor floor it. The organizer can regenerate with
    // an explicit duration for a different split.
    const playable = event.duration - MATCH_BUFFER_MINUTES;
    const duration = Math.max(
      1,
      Math.floor(playable / DEFAULT_SHUFFLE_MATCHES),
    );

    const generated = await this.generateTeams(eventId, userId, {
      teamsCount,
      duration,
    });

    // Deal the shuffled players across the teams just created.
    const dealt = dealIntoTeams(shuffled(joined), teamsCount);
    const teams: unknown[] = [];
    for (const [index, team] of generated.teams.entries()) {
      teams.push(
        await this.assignTeamPlayers(
          eventId,
          String((team as { _id: unknown })._id),
          userId,
          { playerIds: dealt[index]?.playerIds ?? [] },
        ),
      );
    }

    return { ...generated, teams };
  }

  /** Fixture list for an event, in match order. */
  async listMatches(eventId: string) {
    const event = await this.eventModel.findById(eventId).select('_id').lean();
    if (!event) throw new NotFoundException('Event not found');

    return this.matchModel
      .find({ eventId: event._id })
      .sort({ matchNumber: 1 })
      .lean();
  }

  /**
   * Enter or correct one fixture's score.
   *
   * Allowed in `playing` and `after_match` — corrections after the whistle are
   * expected, and locking at `after_match` would strand a typo. `playedAt` is
   * stamped on first entry so the two null scores and a null timestamp move
   * together.
   */
  async setMatchScore(
    eventId: string,
    userId: string,
    matchNumber: number,
    dto: UpdateMatchScoreDto,
  ) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canEnterScore(event.status)) {
      throw new BadRequestException(
        `Scores can only be entered once the match is underway (event is '${event.status}')`,
      );
    }

    // One targeted update rather than a read-modify-save of the whole event:
    // two organizers scoring different fixtures no longer overwrite each
    // other, which an embedded array could not prevent.
    const match = await this.matchModel.findOneAndUpdate(
      { eventId: new Types.ObjectId(eventId), matchNumber },
      {
        $set: {
          scoreA: dto.scoreA,
          scoreB: dto.scoreB,
          playedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!match) {
      throw new NotFoundException(`No fixture numbered ${matchNumber}`);
    }

    return match.toJSON();
  }

  /**
   * Standings, derived on read (decision #5) — never stored, so they cannot
   * drift from the fixtures. Seeded with the team names taken from the fixture
   * list so a team yet to play still shows a zero row.
   */
  async standings(eventId: string) {
    const event = await this.eventModel.findById(eventId).select('_id').lean();
    if (!event) throw new NotFoundException('Event not found');

    const matches = await this.matchModel.find({ eventId: event._id }).lean();
    const teamNames = [...new Set(matches.flatMap((m) => [m.teamA, m.teamB]))];
    return computeStandings(matches, teamNames);
  }

  // --- Step 3: after-match ------------------------------------------------

  /**
   * MVP and the optional overall score (§4.4), `after_match` only.
   *
   * The MVP must be a joined player: naming someone who never played would
   * corrupt the profile `mvpCount` that parent §2.3 feeds from.
   */
  async submitResult(eventId: string, userId: string, dto: SubmitResultDto) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canSubmitResult(event.status)) {
      throw new BadRequestException(
        `The result can only be submitted after the match (event is '${event.status}')`,
      );
    }

    if (dto.mvpUserId) {
      const player = await this.playerModel.findOne({
        eventId: new Types.ObjectId(eventId),
        userId: new Types.ObjectId(dto.mvpUserId),
        status: 'joined',
      });
      if (!player) {
        throw new BadRequestException(
          'The MVP must be a player who joined this event',
        );
      }
    }

    event.result = {
      mvpUserId: dto.mvpUserId ? new Types.ObjectId(dto.mvpUserId) : null,
      scoreA: dto.scoreA ?? null,
      scoreB: dto.scoreB ?? null,
    } as EventDocument['result'];
    await event.save();

    return event.toJSON();
  }

  /**
   * Set or replace the cover image.
   *
   * The previous file is deleted best-effort AFTER the new one is stored: a
   * failed cleanup leaves an orphaned ImageKit file, which is far better than
   * deleting first and losing the cover if the upload then fails.
   */
  async setCover(eventId: string, userId: string, file: Express.Multer.File) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canModify(event.status)) {
      throw new BadRequestException('A completed event can no longer be edited');
    }

    const previousFileId = event.coverImageFileId;
    const uploaded = await this.imagekit.upload(
      file.buffer,
      `event-${eventId}-cover`,
      'events/covers',
    );

    event.coverImage = uploaded.url;
    event.coverImageFileId = uploaded.fileId;
    await event.save();

    if (previousFileId) {
      await this.imagekit.deleteFile(previousFileId).catch(() => undefined);
    }

    return { coverImage: uploaded.url, coverImageFileId: uploaded.fileId };
  }

  /** Add an after-match photo. `after_match` only, per the action gates. */
  async addPhoto(eventId: string, userId: string, file: Express.Multer.File) {
    const event = await this.assertOrganizer(eventId, userId);
    if (!canSubmitResult(event.status)) {
      throw new BadRequestException(
        `Photos can only be added after the match (event is '${event.status}')`,
      );
    }

    const uploaded = await this.imagekit.upload(
      file.buffer,
      `event-${eventId}-photo`,
      'events/photos',
    );

    event.photos.push({ url: uploaded.url, fileId: uploaded.fileId });
    await event.save();

    return { photos: event.photos };
  }

  /**
   * Remove a photo. Deletes the row first, then the remote file: if ImageKit
   * fails we would rather leak a file than leave a broken URL on the event.
   */
  async removePhoto(eventId: string, userId: string, fileId: string) {
    const event = await this.assertOrganizer(eventId, userId);

    const index = event.photos.findIndex((photo) => photo.fileId === fileId);
    if (index === -1) throw new NotFoundException('Photo not found');

    event.photos.splice(index, 1);
    await event.save();
    await this.imagekit.deleteFile(fileId).catch(() => undefined);

    return { photos: event.photos };
  }

  // --- Step 4: discovery, likes, templates --------------------------------

  /**
   * Idempotent like. The unique index does the real work — a second call hits
   * the duplicate and leaves `likeCount` alone rather than double-counting.
   */
  async like(eventId: string, userId: string) {
    const event = await this.eventModel.findById(eventId).select('_id').lean();
    if (!event) throw new NotFoundException('Event not found');

    const result = await this.likeModel.updateOne(
      {
        eventId: new Types.ObjectId(eventId),
        userId: new Types.ObjectId(userId),
      },
      {
        $setOnInsert: {
          eventId: new Types.ObjectId(eventId),
          userId: new Types.ObjectId(userId),
        },
      },
      { upsert: true },
    );

    // upsertedCount is 0 when the like already existed — only count new rows.
    if (result.upsertedCount) {
      await this.eventModel.updateOne(
        { _id: new Types.ObjectId(eventId) },
        { $inc: { likeCount: 1 } },
      );
    }

    return { message: 'Event liked' };
  }

  /** Unlike. Also idempotent: removing a like that isn't there is a no-op. */
  async unlike(eventId: string, userId: string) {
    const result = await this.likeModel.deleteOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
    });

    if (result.deletedCount) {
      // The $gt guard keeps a double-unlike from driving the counter negative.
      await this.eventModel.updateOne(
        { _id: new Types.ObjectId(eventId), likeCount: { $gt: 0 } },
        { $inc: { likeCount: -1 } },
      );
    }

    return { message: 'Event unliked' };
  }

  /** The caller's templates, newest first. */
  async listTemplates(userId: string) {
    return this.templateModel
      .find({ ownerId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();
  }

  async createTemplate(userId: string, dto: CreateEventTemplateDto) {
    if (dto.locationId) {
      await this.locationsService.assertCanEdit(dto.locationId, userId);
    }
    return this.templateModel.create({
      ...dto,
      ownerId: new Types.ObjectId(userId),
      groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : null,
      locationId: dto.locationId ? new Types.ObjectId(dto.locationId) : null,
    });
  }

  async removeTemplate(templateId: string, userId: string) {
    // Validate before constructing an ObjectId: a malformed id would otherwise
    // throw a raw BSONError (500) instead of the 404 the caller deserves.
    if (!Types.ObjectId.isValid(templateId)) {
      throw new NotFoundException('Template not found');
    }

    const template = await this.templateModel.findById(templateId);
    if (!template) throw new NotFoundException('Template not found');
    if (template.ownerId.toString() !== userId) {
      throw new ForbiddenException('You can only delete your own templates');
    }
    await this.templateModel.deleteOne({
      _id: new Types.ObjectId(templateId),
    });
    return { message: 'Template deleted successfully' };
  }

  /** Joined player ids as strings, in join order. */
  private async joinedPlayerIds(eventId: string): Promise<string[]> {
    const players = await this.playerModel
      .find({ eventId: new Types.ObjectId(eventId), status: 'joined' })
      .select('userId')
      .sort({ joinedAt: 1 })
      .lean();
    return players.map((player) => player.userId.toString());
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

/**
 * Midnight local time today.
 *
 * Expiry is measured by DAY, not by timestamp: an event earlier this afternoon
 * has not "expired" from a user's point of view while the day is still running,
 * and cutting at `new Date()` would drop it from the list mid-event.
 */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Escapes user input so it can be embedded in a RegExp literally. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
