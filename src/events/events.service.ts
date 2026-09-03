import {
  Injectable,
  Logger,
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
  MAX_GUESTS_PER_MEMBER,
  PLAYABLE_APPROVAL,
} from './schemas/event-player.schema';
import { EventMatch, EventMatchDocument } from './schemas/event-match.schema';
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
  EventPayment,
  EventPaymentDocument,
} from './schemas/event-payment.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  Location,
  LocationDocument,
} from '../locations/schemas/location.schema';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { GenerateTeamsDto } from './dto/generate-teams.dto';
import { AssignTeamPlayersDto } from './dto/assign-team-players.dto';
import { AddMatchDto } from './dto/add-match.dto';
import { UpdateMatchScoreDto } from './dto/update-match-score.dto';
import { SubmitResultDto } from './dto/submit-result.dto';
import { CreateEventTemplateDto } from './dto/create-event-template.dto';
import { LocationsService } from '../locations/locations.service';
import { ImageKitService } from '../common/upload/imagekit.service';
import {
  decodeCursor,
  keysetFilter,
  toPage,
} from '../common/pagination/cursor';
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
  FINISHED_STATUSES,
} from './events.lifecycle';
import {
  Team,
  TeamDocument,
  DEFAULT_TEAM_MEMBER_ROLE,
} from './schemas/team.schema';
import { SetPaymentDto } from './dto/set-payment.dto';
import { AddGuestDto } from './dto/add-guest.dto';
import { SetGuestApprovalDto } from './dto/set-guest-approval.dto';
import { SetTeamMemberRoleDto } from './dto/set-team-member-role.dto';
import {
  MATCH_BUFFER_MINUTES,
  MIN_TEAMS,
  TEAM_COLOURS,
  computeStandings,
  dealIntoTeams,
  generateFixturesFilling,
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

/** Group roles that may manage an event: edit, delete, transition, teams. */
const ORGANIZER_ROLES = ['owner', 'admin'] as const;

/**
 * Group roles that may enter a match score.
 *
 * `referee` is added here and NOWHERE else — officiating is the one thing the
 * role is for. It grants no other event permission.
 */
const SCORER_ROLES = ['owner', 'admin', 'referee'] as const;

/**
 * Group roles that may set a player's role inside a team.
 *
 * Adds `captain` to the organizer pair: naming a captain is squad management,
 * which is what the group captain role exists for. It grants nothing else —
 * a captain still cannot edit the event, change its status or take payments.
 */
const TEAM_ROLE_MANAGER_ROLES = ['owner', 'admin', 'captain'] as const;

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
  private readonly logger = new Logger(EventsService.name);

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
    @InjectModel(EventPayment.name)
    private paymentModel: Model<EventPaymentDocument>,
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
    allowedRoles: readonly string[] = ORGANIZER_ROLES,
  ): Promise<EventDocument> {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');

    if (event.groupId) {
      const member = await this.memberModel.findOne({
        groupId: event.groupId,
        userId: new Types.ObjectId(userId),
        status: 'approved',
        role: { $in: [...allowedRoles] },
      });
      // The creator keeps control even if they later lose their group role.
      if (!member && event.createdBy.toString() !== userId) {
        throw new ForbiddenException(
          `Only the event creator or a group ${allowedRoles.join('/')} ` +
            'can perform this action',
        );
      }
    } else if (event.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        'Only the event creator can manage this event',
      );
    }

    return event;
  }

  /**
   * Like `assertOrganizer`, but also admits a group `referee`.
   *
   * Scoring is the one action a referee owns — they officiate the match, so
   * they enter its result. Everything else (editing the event, generating
   * teams, deleting, uploads) stays with owner/admin, which is why this is a
   * separate call rather than widening `ORGANIZER_ROLES`: that list guards
   * twelve other operations a referee has no business performing.
   */
  private assertCanScore(eventId: string, userId: string) {
    return this.assertOrganizer(eventId, userId, SCORER_ROLES);
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

    // Visibility: anything public, PLUS anything the caller is on the roster
    // of. The second half is what lets a private group's event appear in the
    // caller's own discovery list — being on the roster is the permission,
    // exactly as it is for GET /events/joined.
    //
    // A disjunction rather than a bare `isPublic: true`, and it sits in $or at
    // the top level so the region/date/status/geo narrowings below stay ANDed
    // against it: a joined event must not bypass an explicit filter.
    const joinedIds = await this.joinedEventIds(userId);
    const filter: Record<string, unknown> = joinedIds.length
      ? { $or: [{ isPublic: true }, { _id: { $in: joinedIds } }] }
      : // No roster rows means the disjunction could only ever match the
        // public half, so keep the simpler filter and let the index work.
        { isPublic: true };

    if (region?.trim()) {
      // country/city are stored lowercase, so this is an exact match on a
      // canonical form rather than a case-insensitive regex. That lets the
      // {country, city} index actually be used — a /^…$/i regex cannot use it.
      const needle = region.trim().toLowerCase();
      const groups = await this.groupModel
        .find({ $or: [{ country: needle }, { city: needle }] })
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
      // An explicit ask wins, `after_match` and `done` included — same rule as
      // GET /events/joined. Hiding them by default must not make them
      // unreachable, or the history screen has no query left to run.
      filter.status = status;
    } else {
      // This is a DISCOVERY list: a played fixture is not something anyone can
      // still turn up to, so neither finished state belongs here by default.
      // `after_match` is excluded for the same reason as `done` — the match has
      // happened; only the result is outstanding.
      //
      // Deliberately NOT applied to search(), listByGroup() or listJoined(),
      // which still hide `done` alone. Narrowing this one list was the ask; a
      // player looking at their own fixtures or a group's history has more
      // reason to see a match still awaiting its score. Revisit together if
      // the four lists need to agree.
      filter.status = { $nin: FINISHED_STATUSES };
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

    // The list now mixes public events with the caller's own, so say which is
    // which — otherwise a client cannot distinguish a private event it may
    // open from a public one it has not joined. Matches GET /events/:id and
    // GET /events/joined, which both carry this flag.
    const joined = new Set(joinedIds.map(String));
    return events.map((event) => ({
      ...withIsFull(event),
      joinedByMe: joined.has(String(event._id)),
    }));
  }

  /**
   * Free-text search over public events, soonest first.
   *
   * Separate from `list()` rather than a `?q=` on it, so the two stay easy to
   * reason about: this one is "find me an event by name", that one is "browse
   * with filters". Both apply the same visibility rule — `isPublic: true` —
   * because a private group's event must not surface to a non-member here.
   *
   * Matches `title` and `description` case-insensitively as a substring. No
   * text index: at this scale a regex scan is fine, and a $text index would
   * bring stemming and language config that the caller has not asked for.
   *
   * Expired and `done` events are hidden by default, matching
   * `listByGroup` and `listJoined` — searching is a forward-looking act.
   */
  async search(
    q: string,
    includeExpired = false,
    limit = DEFAULT_SEARCH_LIMIT,
    cursor?: string,
  ) {
    const term = (q ?? '').trim();
    // An empty regex matches everything; that is a listing, not a search.
    if (!term) return { items: [], nextCursor: null, hasMore: false };

    const rx = new RegExp(escapeRegex(term), 'i');
    const filter: Record<string, unknown> = {
      isPublic: true,
      $or: [{ title: rx }, { description: rx }],
    };

    if (!includeExpired) {
      filter.date = { $gte: startOfToday() };
      filter.status = { $ne: 'done' };
    }

    // The keyset goes in $and: the query already uses a top-level $or for the
    // title/description match, and a second $or key would overwrite it.
    if (cursor) {
      filter.$and = [keysetFilter(decodeCursor(cursor), 'date')];
    }

    const size = clampLimit(limit);
    const events = await this.eventModel
      .find(filter)
      // _id makes the sort total, so the keyset cannot straddle a shared date.
      .sort({ date: 1, _id: 1 })
      // +1 is the lookahead that answers hasMore without a count query.
      .limit(size + 1)
      .lean();

    const page = toPage(events, size, (row: any) => ({
      d: new Date(row.date).toISOString(),
      i: String(row._id),
    }));
    return { ...page, items: page.items.map(withIsFull) };
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

    const group = await this.groupModel
      .findById(groupId)
      .select('_id isPrivate')
      .lean();
    if (!group) throw new NotFoundException('Group not found');

    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
    });

    // A private group hides its whole schedule, not just its private events:
    // being able to see that the group exists (it is searchable) must not also
    // reveal when and where it plays. Approval is the gate — a pending request
    // is not membership.
    //
    // 403 rather than an empty list on purpose. The caller CAN see this group
    // in search, so the honest answer is "join to see this", which also lets
    // the client render a join prompt instead of a misleading "no events yet".
    if (group.isPrivate && !member) {
      throw new ForbiddenException(
        'This group is private — join it to see its events',
      );
    }

    const filter: Record<string, unknown> = {
      groupId: new Types.ObjectId(groupId),
    };
    // A public group still hides its individually-private events.
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
  async listJoined(userId: string, status?: string, includeExpired = false) {
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
      // An explicit ask wins, `done` included — that is the history screen.
      filter.status = status;
    } else {
      // This is the ONGOING list, so a finished event is never in it. Unlike
      // the date rule below, `includeExpired` does not lift this: asking for
      // past dates is asking for older fixtures, not for completed events.
      // Reaching a done event at all takes an explicit `?status=done`.
      filter.status = { $ne: 'done' };
    }

    // `includeExpired` is purely about DATES. Same rule as listByGroup, so the
    // two lists agree on what "expired" means.
    if (!includeExpired) {
      filter.date = { $gte: startOfToday() };
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
    const event = await this.eventModel.create({
      ...rest,
      date: new Date(dto.date),
      startTime: dto.startTime ? new Date(dto.startTime) : null,
      endTime: dto.endTime ? new Date(dto.endTime) : null,
      groupId: rest.groupId ? new Types.ObjectId(rest.groupId) : null,
      locationId: locationId ? new Types.ObjectId(locationId) : null,
      templateId: templateId ? new Types.ObjectId(templateId) : null,
      createdBy: new Types.ObjectId(userId),
    });

    await this.notifyGroupOfNewEvent(event, userId);
    return event;
  }

  /**
   * Tells the joined roster that the teams are set and kick-off is next.
   *
   * Addressed to the people PLAYING, not to the group: someone who never
   * joined has no stake in the line-up, and this is the notification that most
   * needs to reach a phone in a pocket.
   *
   * Guests are excluded, unavoidably rather than by choice — a guest has no
   * account, so no device token and no notification row. Their sponsor is the
   * contact, which is one more reason the sponsor relationship is load-bearing.
   */
  private async notifyRosterReadyToPlay(event: EventDocument): Promise<void> {
    try {
      const playerIds = await this.joinedPlayerIds(String(event._id));

      await this.notificationsService.notifyUsers(playerIds, {
        title: 'Teams are ready',
        body: `${event.title} — check your team and get ready to play.`,
        type: 'event',
        refId: String(event._id),
      });
    } catch (err) {
      this.logger.error(`Failed to announce ready_to_play: ${err}`);
    }
  }

  /**
   * Tells a group its new event exists.
   *
   * Only for group events — a standalone event has no audience to announce it
   * to, so this is a no-op there rather than a special case at the call site.
   *
   * Recipients are the group's **approved** members, minus the creator: they
   * just made it, and being told about your own action is noise. Pending
   * requesters are excluded on the same reasoning as everywhere else on this
   * branch — approval is what grants visibility, and a private group's event
   * must not leak to someone still waiting.
   *
   * Awaited but never allowed to throw. `notifyUsers` swallows its own
   * failures, and this method guards the audience query too, so a notification
   * problem cannot turn a successful `POST /events` into a 500.
   */
  private async notifyGroupOfNewEvent(
    event: EventDocument,
    creatorId: string,
  ): Promise<void> {
    if (!event.groupId) return;

    try {
      const members = await this.memberModel
        .find({ groupId: event.groupId, status: 'approved' })
        .select('userId')
        .lean();

      const recipients = members
        .map((member) => String(member.userId))
        .filter((id) => id !== creatorId);

      await this.notificationsService.notifyUsers(recipients, {
        title: 'New event',
        body: `${event.title} — ${new Date(event.date).toDateString()}`,
        type: 'event',
        refId: String(event._id),
      });
    } catch (err) {
      this.logger.error(`Failed to announce new event: ${err}`);
    }
  }

  /**
   * Event detail, with the owning group's rules attached.
   *
   * `groupRules` is a read-only projection — the rules live on the Group and are
   * edited via PATCH /groups/:id. Always an array (never null) so the
   * client can render it unconditionally; `[]` for events with no group.
   */
  async findById(eventId: string, userId?: string) {
    // Validate before Mongoose casts: a malformed id otherwise throws a raw
    // BSONError and surfaces as a 500. Notably this is what a mistyped static
    // segment hits — `/events/mine` falls through to `@Get(':id')` and should
    // read as "no such event", not as a server fault.
    if (!Types.ObjectId.isValid(eventId)) {
      throw new NotFoundException('Event not found');
    }

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

    // A guest is somebody's plus-one, so they go when their sponsor goes.
    const guestsRemoved = await this.cascadeGuestsOfSponsor(eventId, userId);

    return {
      message: 'Left event successfully',
      // Surfaced so the client can say "you and your 2 guests left" rather
      // than silently dropping people the member added.
      guestsRemoved,
    };
  }

  /**
   * Organizer removes another player from the event.
   *
   * The mirror of `leave`, with the caller and the subject separated: the
   * organizer is authorised from `requesterId`, and the roster row is found by
   * `targetUserId`. Conflating the two would remove the organizer instead of
   * the player they picked, so there is a test pinning which id is queried.
   *
   * Gated to `join`, exactly like self-leave. Past that point teams and
   * fixtures reference the roster, and pulling a player out from under them
   * would leave a team short and the fixture list wrong with no repair step.
   * An organizer who needs to remove someone later can reopen registration
   * first (`preparation -> join`), which the transition table already allows.
   *
   * Cancels rather than deletes, matching `leave`, so the row can be
   * reactivated if the player rejoins.
   */
  async removePlayer(
    eventId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    const event = await this.assertOrganizer(eventId, requesterId);

    if (!canLeave(event.status)) {
      throw new BadRequestException(
        'Registration has closed for this event; reopen it before removing players',
      );
    }

    const player = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(targetUserId),
      status: 'joined',
    });
    if (!player) {
      throw new NotFoundException('That user has not joined this event');
    }

    player.status = 'cancelled';
    await player.save();

    // Same guarded decrement as `leave`: the $gt keeps a double-removal from
    // driving the count negative.
    await this.eventModel.findOneAndUpdate(
      { _id: eventId, status: 'join', joinedCount: { $gt: 0 } },
      { $inc: { joinedCount: -1 } },
    );

    const guestsRemoved = await this.cascadeGuestsOfSponsor(
      eventId,
      targetUserId,
    );

    return { message: 'Player removed from event', guestsRemoved };
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

    // Tell the people actually playing that the teams are final. Fired only on
    // the transition INTO ready_to_play, not on every save, so re-entering the
    // state from `playing` is the only way to notify twice — and that is a
    // deliberate act by the organizer.
    if (to === 'ready_to_play') {
      await this.notifyRosterReadyToPlay(event);
    }

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
      throw new BadRequestException(
        'A completed event can no longer be edited',
      );
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
      'additionalPrice',
      'takeAdditionalPrice',
      'isAllowExtraPlayer',
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
      throw new BadRequestException(
        'A completed event can no longer be deleted',
      );
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

  /**
   * Deletes every event belonging to a group, and everything under them.
   *
   * Exists for `DELETE /groups/:id`. Lives here rather than in GroupsService
   * because the collections being cleared are this module's — a group has no
   * business knowing that an event owns fixtures, chats, likes and payments,
   * and duplicating that list there would guarantee the two drift as event
   * sub-collections are added.
   *
   * Deliberately takes NO permission argument. Authorisation is the caller's
   * job: `GroupsService.remove` has already established the caller owns the
   * group, and re-deriving organizer rights per event would be both wasteful
   * and wrong — a group owner may delete an event they did not create.
   *
   * Unlike `remove`, this ignores the `done` guard. That check protects an
   * organizer from destroying a finished event by accident; here the owner has
   * explicitly asked for the whole group to go, archived events included.
   */
  async removeAllForGroup(groupId: string) {
    const groupObjectId = new Types.ObjectId(groupId);

    const events = await this.eventModel
      .find({ groupId: groupObjectId })
      .select('_id')
      .lean();
    const eventIds = events.map((event) => event._id);

    // Teams and templates hang off the GROUP as well as off events, so they are
    // cleared by groupId — a template belongs to the group, not to any one
    // event, and would otherwise survive with a dangling reference.
    await this.templateModel.deleteMany({ groupId: groupObjectId });

    if (!eventIds.length) {
      await this.teamModel.deleteMany({ groupId: groupObjectId });
      return { events: 0 };
    }

    const byEvent = { eventId: { $in: eventIds } };
    await Promise.all([
      this.playerModel.deleteMany(byEvent),
      this.matchModel.deleteMany(byEvent),
      this.teamModel.deleteMany(byEvent),
      this.teamChatModel.deleteMany(byEvent),
      this.likeModel.deleteMany(byEvent),
      this.paymentModel.deleteMany(byEvent),
    ]);
    // Teams also carry groupId; sweep any left by an event already gone.
    await this.teamModel.deleteMany({ groupId: groupObjectId });
    await this.eventModel.deleteMany({ _id: { $in: eventIds } });

    return { events: eventIds.length };
  }

  /**
   * The event roster: registered players and APPROVED guests.
   *
   * Pending and rejected guests are excluded — they are not playing, and a
   * team-builder reading this list must not be offered them. Use
   * `GET /events/:id/guests` to see them awaiting a decision.
   *
   * A guest row has no `userId` to populate, so the client reads `guestName`
   * and `type` instead. Branch on `type`, not on the presence of `userId`.
   */
  async listPlayers(eventId: string) {
    return this.playerModel
      .find({
        eventId: new Types.ObjectId(eventId),
        status: 'joined',
        approval: PLAYABLE_APPROVAL,
      })
      .populate('userId', 'name profileImage')
      .populate('addedByUserId', 'name profileImage')
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
  /**
   * `POST /events/:id/teams/generate` — create the teams and the fixture list.
   *
   * Returns a plain success message. The teams and fixtures it writes are read
   * back through `GET /events/:id/teams` and `GET /events/:id/matches`, so
   * echoing them here would be a second, divergent source for the same data.
   */
  async generateTeams(
    eventId: string,
    userId: string,
    dto: GenerateTeamsDto,
  ): Promise<{ message: string }> {
    await this.createTeamsAndFixtures(eventId, userId, dto, {
      persistTeamCount: true,
    });
    return { message: 'Teams created successfully' };
  }

  /**
   * The work behind `generateTeams`, returning what it created.
   *
   * Split out because `shuffleTeams` needs the new teams' ids to deal players
   * into them. Re-reading them afterwards would work but is a needless round
   * trip and would depend on insertion order surviving the query.
   */
  private async createTeamsAndFixtures(
    eventId: string,
    userId: string,
    dto: GenerateTeamsDto,
    { persistTeamCount = false }: { persistTeamCount?: boolean } = {},
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
    const names = this.resolveTeamNames(dto);

    // Record the organizer's choice on the event, so `event.teamCount` and the
    // teams that actually exist cannot disagree. Without this, generating 3
    // teams left teamCount at its old value and a later POST /shuffle — which
    // reads only that field — silently rebuilt with a different count.
    //
    // Set AFTER the validations above, so a rejected request leaves the event
    // untouched.
    //
    // Only on the generate path. A shuffle's team count is capped by the
    // roster, so persisting it there would permanently downgrade the
    // organizer's intent: 4 intended with 2 joined would pin teamCount to 2
    // even once the roster filled up.
    if (persistTeamCount && event.teamCount !== names.length) {
      event.teamCount = names.length;
      await event.save();
    }

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
        numberOfPlayers: dto.numberOfPlayers,
        status: 'pending',
      })),
    );

    // Fixtures are derived now, from the team NAMES — assignment comes later and
    // does not change who plays whom.
    //
    // Enough fixtures to fill the booked slot, never fewer than a full
    // round-robin.
    //
    // Two failure modes, one on each side. Trimming to the slot dropped the
    // tail of the schedule — three teams in a short event lost half their
    // pairings. Emitting only the round-robin left the opposite gap: a
    // two-hour event of ten-minute matches has room for 11, and six fixtures
    // leave an hour of pitch time unscheduled. The floor is the round-robin,
    // the target is the slot.
    const fixtures = generateFixturesFilling(names, matchCount);
    await this.matchModel.deleteMany({ eventId: eventObjectId });
    const matches = await this.matchModel.insertMany(
      fixtures.map((fixture) => ({
        ...fixture,
        eventId: eventObjectId,
        // Per fixture, not per team: the schedule is what has a length.
        duration: dto.duration,
      })),
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

    return { teams, matches };
  }

  /**
   * The team names to use, from `dto.colors` when supplied.
   *
   * Spelling is not checked — the caller may name teams anything. Count and
   * distinctness ARE checked: a name keys both the fixture list and the team
   * chat room, so a duplicate makes both ambiguous, and a count that disagrees
   * with `teamsCount` leaves it unclear how many teams to create.
   */
  private resolveTeamNames(dto: GenerateTeamsDto): string[] {
    if (!dto.colors) {
      return TEAM_COLOURS.slice(0, dto.teamsCount).map(String);
    }

    const colors = dto.colors.map((c) => c.trim()).filter((c) => c.length > 0);
    if (colors.length !== dto.teamsCount) {
      throw new BadRequestException(
        `Expected ${dto.teamsCount} team colours to match teamsCount, got ${colors.length}`,
      );
    }

    const seen = new Set(colors.map((c) => c.toLowerCase()));
    if (seen.size !== colors.length) {
      throw new BadRequestException(
        'Team colours must be distinct — two teams cannot share a name',
      );
    }

    return colors;
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

    // Enforce the squad size set at generation time. This is now a hard limit,
    // not just a display target: an over-filled team would field more players
    // than the organizer planned for, and nothing downstream would catch it.
    // Under-filling stays legal — a roster is built up incrementally.
    // --- Guests, validated on the same terms as players ---------------------
    const guestRoster = (dto.guestIds ?? []).map(String);
    if (guestRoster.length) {
      const approvedGuests = await this.approvedGuestIds(eventId);
      const notApproved = guestRoster.find(
        (id) => !approvedGuests.includes(id),
      );
      if (notApproved) {
        throw new BadRequestException(
          `Guest ${notApproved} is not an approved guest on this event`,
        );
      }
      const dupGuest = guestRoster.find(
        (id, i) => guestRoster.indexOf(id) !== i,
      );
      if (dupGuest) {
        throw new BadRequestException(
          `Guest ${dupGuest} is listed twice in this team`,
        );
      }
    }

    // The squad limit counts EVERYONE who will take the pitch. Checking only
    // registered players would let a team of 9 plus 2 guests quietly field 11.
    if (roster.length + guestRoster.length > team.numberOfPlayers) {
      throw new BadRequestException(
        `${team.name} holds at most ${team.numberOfPlayers} player(s); ` +
          `received ${roster.length} player(s) and ${guestRoster.length} ` +
          'guest(s). Regenerate the teams with a larger numberOfPlayers to ' +
          'raise the limit.',
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
      const guestClash = guestRoster.find((id) =>
        (other.guests ?? []).some((g) => g.toString() === id),
      );
      if (guestClash) {
        throw new BadRequestException(
          `Guest ${guestClash} is already in ${other.name}`,
        );
      }
    }

    if (dto.name !== undefined) team.name = dto.name.trim();
    team.players = roster.map((id) => new Types.ObjectId(id));
    team.guests = guestRoster.map((id) => new Types.ObjectId(id));
    team.status = roster.length || guestRoster.length ? 'ready' : 'pending';

    // Roles annotate `players`, so a player dropped from the squad must not
    // keep a captaincy here — it would be invisible to every read and would
    // reappear if they were assigned again later.
    const rosterIds = new Set(roster.map(String));
    team.playerRoles = (team.playerRoles ?? []).filter((entry) =>
      rosterIds.has(entry.userId.toString()),
    );
    await team.save();

    // Keep EventPlayer.team in step — it is what player-facing reads use.
    await this.playerModel.updateMany(
      { eventId: eventObjectId, team: team.name },
      { $set: { team: null } },
    );

    // Guests are stamped by roster-row `_id`, not by `userId`: they have none,
    // so the userId-keyed update below can never reach them. Without this a
    // guest sat in `team.guests` while their own row still read `team: null` —
    // two sources of truth disagreeing, and no way to answer "which team is
    // this guest in?" from the roster.
    if (guestRoster.length) {
      await this.playerModel.updateMany(
        { _id: { $in: guestRoster.map((id) => new Types.ObjectId(id)) } },
        { $set: { team: team.name } },
      );
    }

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

    return (
      this.teamModel
        .find({ eventId: event._id })
        .populate('players', 'name profileImage')
        // Guests come from the roster collection, so the useful fields are the
        // guest's display name and who brought them — they have no user account
        // and therefore no profile image of their own.
        .populate('guests', 'guestName addedByUserId type approval')
        .sort({ name: 1 })
        .lean()
    );
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
    const guests = await this.approvedGuestIds(eventId);

    // Guests count toward the minimum: they are playing, so an event with one
    // registered player and two approved guests is shuffleable.
    if (joined.length + guests.length < MIN_TEAMS) {
      throw new BadRequestException(
        `At least ${MIN_TEAMS} joined players are needed to shuffle teams`,
      );
    }

    // Cap at the player count: dealing 3 players into 4 teams leaves an empty
    // team, and an empty team still appears in fixtures it can never play.
    const teamsCount = Math.max(
      MIN_TEAMS,
      Math.min(event.teamCount ?? 4, joined.length + guests.length),
    );

    // The shuffle takes no body, so it has no duration of its own — but it must
    // not invent one either. It used to derive `floor((event.duration - 10) / 3)`
    // and write that over whatever the organizer had set at generation time: a
    // 90-minute event silently turned a deliberate 15 into 26.
    //
    // Reuse the duration already scheduled. Only when there is no schedule at
    // all — a shuffle before any generate — does it fall back to the derived
    // value, which is a genuine first-time default rather than a clobber.
    const duration =
      (await this.scheduledMatchDuration(eventId)) ??
      Math.max(
        1,
        Math.floor(
          (event.duration - MATCH_BUFFER_MINUTES) / DEFAULT_SHUFFLE_MATCHES,
        ),
      );

    const generated = await this.createTeamsAndFixtures(eventId, userId, {
      teamsCount,
      duration,
      // The shuffle deals everyone who will play — registered and guests — so
      // the squad size each team aims for IS its share of the whole roster,
      // rounded up since a remainder lands on the earlier teams. Counting only
      // registered players here would set a limit the guests then breach.
      numberOfPlayers: Math.ceil((joined.length + guests.length) / teamsCount),
    });

    // Deal the shuffled players across the teams just created, and the guests
    // separately. Two deals rather than one over a merged list, because the two
    // land in different fields — `players` takes user ids, `guests` takes
    // roster-row ids — and mixing them would need the ids tagged and split
    // again at the far end.
    const dealt = dealIntoTeams(shuffled(joined), teamsCount);
    const dealtGuests = dealIntoTeams(shuffled(guests), teamsCount);
    const teams: unknown[] = [];
    for (const [index, team] of generated.teams.entries()) {
      teams.push(
        await this.assignTeamPlayers(
          eventId,
          String((team as { _id: unknown })._id),
          userId,
          {
            playerIds: dealt[index]?.playerIds ?? [],
            guestIds: dealtGuests[index]?.playerIds ?? [],
          },
        ),
      );
    }

    return { message: 'Teams shuffled successfully', teams };
  }

  /**
   * `POST /events/:id/matches` — add one fixture by hand.
   *
   * Deliberately narrow. It does NOT touch the round-robin, check the duration
   * budget, or renumber anything: the generated schedule sometimes leaves a
   * team without a fixture (3 teams in a 60-minute event fits one match), and
   * this is the escape hatch for that. It appends; nothing else changes.
   *
   * Consequences, accepted by decision:
   *  - `matches[]` may no longer form a valid double round-robin. Standings
   *    still compute correctly — the fold is defined over the fixtures as
   *    stored, whatever they are.
   *  - Total scheduled minutes may exceed what the event's duration allows.
   *  - A later `POST /teams/generate` or `/shuffle` REPLACES the fixture list
   *    wholesale, so a hand-added match is lost. Add after generating, not
   *    before.
   */
  async addMatch(eventId: string, userId: string, dto: AddMatchDto) {
    const event = await this.assertOrganizer(eventId, userId);
    const eventObjectId = event._id as Types.ObjectId;

    const teamA = dto.teamA.trim();
    const teamB = dto.teamB.trim();
    if (teamA.toLowerCase() === teamB.toLowerCase()) {
      throw new BadRequestException('A team cannot play itself');
    }

    // Both names must be real teams on this event. The name keys the fixture,
    // so a typo would otherwise create a match that no team can be matched to
    // and that quietly skews standings under a phantom name.
    const teams = await this.teamModel
      .find({ eventId: eventObjectId })
      .select('name')
      .lean();
    if (!teams.length) {
      throw new BadRequestException(
        'This event has no teams yet — generate them before adding a fixture',
      );
    }
    const byName = new Map(teams.map((t) => [t.name.toLowerCase(), t.name]));
    for (const name of [teamA, teamB]) {
      if (!byName.has(name.toLowerCase())) {
        throw new BadRequestException(
          `'${name}' is not a team on this event. Teams: ` +
            teams.map((t) => t.name).join(', '),
        );
      }
    }

    // Append after the current highest. matchNumber is uniquely indexed per
    // event, so the caller must not choose it — they cannot see what is free.
    const last = await this.matchModel
      .findOne({ eventId: eventObjectId })
      .sort({ matchNumber: -1 })
      .select('matchNumber')
      .lean();
    const matchNumber = (last?.matchNumber ?? 0) + 1;

    const created = await this.matchModel.create({
      eventId: eventObjectId,
      matchNumber,
      // Store the canonical casing from the team record, so fixtures and teams
      // always agree on the name even if the caller typed 'blue'.
      teamA: byName.get(teamA.toLowerCase()),
      teamB: byName.get(teamB.toLowerCase()),
      scoreA: null,
      scoreB: null,
      playedAt: null,
    });

    return created.toJSON();
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
    // Referees may score; see assertCanScore.
    const event = await this.assertCanScore(eventId, userId);
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
      throw new BadRequestException(
        'A completed event can no longer be edited',
      );
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
  // --- Guests (+1 / +2) ---------------------------------------------------

  /**
   * A joined member brings a guest who has no account.
   *
   * Created `pending`: the guest is not on the roster and does not count toward
   * capacity until an organizer approves them, which is the whole point of the
   * flow. `joinedCount` is therefore NOT touched here.
   *
   * Gated to `join`, like every other roster change. The cap counts
   * non-rejected rows only - counting rejections would let a member add, be
   * rejected, and retry forever.
   */
  async addGuest(eventId: string, sponsorId: string, dto: AddGuestDto) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    if (!canJoin(event.status)) {
      throw new BadRequestException(
        'Guests can only be added while registration is open',
      );
    }

    // Checked BEFORE the roster lookup on purpose: a non-member asking about a
    // guests-disabled event should hear "this event does not allow guests"
    // rather than "join first", since joining would not help them.
    if (!event.isAllowExtraPlayer) {
      throw new BadRequestException('This event does not allow extra players');
    }

    // Only someone playing may bring someone. An organizer who never joined
    // has no roster row and so no guest allowance of their own.
    // The sponsor's name is populated because it seeds the default guestName —
    // cheaper than injecting the User model into this service for one string.
    const sponsor = await this.playerModel
      .findOne({
        eventId: new Types.ObjectId(eventId),
        userId: new Types.ObjectId(sponsorId),
        status: 'joined',
      })
      .populate('userId', 'name');
    if (!sponsor) {
      throw new ForbiddenException('Join the event before adding a guest');
    }

    const alreadyBrought = await this.playerModel.countDocuments({
      eventId: new Types.ObjectId(eventId),
      addedByUserId: new Types.ObjectId(sponsorId),
      status: 'joined',
      approval: { $ne: 'rejected' },
    });
    if (alreadyBrought >= MAX_GUESTS_PER_MEMBER) {
      throw new BadRequestException(
        `You can add at most ${MAX_GUESTS_PER_MEMBER} guests`,
      );
    }

    const guest = await this.playerModel.create({
      eventId: new Types.ObjectId(eventId),
      type: 'guest',
      guestName:
        dto.guestName?.trim() ||
        (await this.defaultGuestName(eventId, sponsorId, sponsor)),
      addedByUserId: new Types.ObjectId(sponsorId),
      approval: 'pending',
      status: 'joined',
      joinedAt: new Date(),
    });

    return guest.toJSON();
  }

  /**
   * `<sponsor name> guest <n>` — the name used when the client sends none.
   *
   * Lets the UI offer a bare "+ Add Guest" button with nothing to type, while
   * still producing something an organizer can tell apart on an approval list.
   *
   * The sequence counts EVERY guest row this sponsor has ever created for the
   * event, including rejected and withdrawn ones. Numbering off the live
   * allowance instead would reuse "guest 1" after a rejection and collide with
   * the rejected row's own name.
   */
  private async defaultGuestName(
    eventId: string,
    sponsorId: string,
    sponsor: EventPlayerDocument,
  ): Promise<string> {
    const everBrought = await this.playerModel.countDocuments({
      eventId: new Types.ObjectId(eventId),
      addedByUserId: new Types.ObjectId(sponsorId),
      type: 'guest',
    });

    // `userId` is populated to a user document here, not an id.
    const sponsorName = (
      sponsor.userId as unknown as { name?: string } | null
    )?.name?.trim();

    return sponsorName
      ? `${sponsorName} guest ${everBrought + 1}`
      : // No readable name to borrow — still numbered, so two guests from the
        // same member never share a label.
        `Guest ${everBrought + 1}`;
  }

  /**
   * Guests on an event.
   *
   * An organizer sees every guest, because they are the one deciding. Anyone
   * else sees approved guests (they are playing, so they are public) plus their
   * OWN pending and rejected ones - a member should be able to see the decision
   * on someone they brought without reading everyone else's pending list.
   */
  async listGuests(eventId: string, userId: string) {
    const event = await this.eventModel.findById(eventId).select('_id').lean();
    if (!event) throw new NotFoundException('Event not found');

    const filter: Record<string, unknown> = {
      eventId: event._id,
      type: 'guest',
      status: 'joined',
    };

    if (!(await this.isOrganizer(eventId, userId))) {
      filter.$or = [
        { approval: 'approved' },
        { addedByUserId: new Types.ObjectId(userId) },
      ];
    }

    return this.playerModel
      .find(filter)
      .populate('addedByUserId', 'name username displayName profileImage')
      .sort({ createdAt: 1 })
      .lean();
  }

  /**
   * Organizer approves or rejects a guest.
   *
   * Approving is what puts them on the roster, so this is where `joinedCount`
   * moves. Capacity is a SOFT limit by decision: an approved guest may push the
   * event past `maxPlayers` rather than being refused, because a guest arriving
   * with a member is a fact on the ground rather than a booking to validate.
   * `isFull` therefore reports true and joining closes for everyone else, which
   * is the intended effect.
   *
   * Idempotent per target state: re-approving an approved guest does not
   * increment twice.
   */
  async setGuestApproval(
    eventId: string,
    organizerId: string,
    guestId: string,
    dto: SetGuestApprovalDto,
  ) {
    await this.assertOrganizer(eventId, organizerId);

    if (!Types.ObjectId.isValid(guestId)) {
      throw new BadRequestException('Invalid guest id');
    }

    const guest = await this.playerModel.findOne({
      _id: new Types.ObjectId(guestId),
      eventId: new Types.ObjectId(eventId),
      type: 'guest',
    });
    if (!guest) throw new NotFoundException('Guest not found for this event');

    const was = guest.approval;
    if (was === dto.approval) return guest.toJSON();

    guest.approval = dto.approval;
    await guest.save();

    // Only a transition into or out of `approved` moves the count.
    if (dto.approval === 'approved') {
      await this.eventModel.updateOne(
        { _id: guest.eventId },
        { $inc: { joinedCount: 1 } },
      );
    } else if (was === 'approved') {
      await this.eventModel.updateOne(
        { _id: guest.eventId, joinedCount: { $gt: 0 } },
        { $inc: { joinedCount: -1 } },
      );
    }

    return guest.toJSON();
  }

  /**
   * Withdraw a guest - by their sponsor, or by an organizer.
   *
   * Cancels rather than deletes, matching how a registered player leaves, so
   * the row survives as a record of who was brought and what was decided.
   */
  async removeGuest(eventId: string, requesterId: string, guestId: string) {
    if (!Types.ObjectId.isValid(guestId)) {
      throw new BadRequestException('Invalid guest id');
    }

    const guest = await this.playerModel.findOne({
      _id: new Types.ObjectId(guestId),
      eventId: new Types.ObjectId(eventId),
      type: 'guest',
      status: 'joined',
    });
    if (!guest) throw new NotFoundException('Guest not found for this event');

    const isSponsor = String(guest.addedByUserId) === requesterId;
    if (!isSponsor && !(await this.isOrganizer(eventId, requesterId))) {
      throw new ForbiddenException(
        'Only the member who added this guest, or an organizer, can remove them',
      );
    }

    await this.cancelGuestRows([guest]);
    return { message: 'Guest removed' };
  }

  /**
   * Cancels guest rows and gives back the capacity the approved ones held.
   *
   * Shared by `removeGuest` and the sponsor cascade so the count is adjusted in
   * exactly one place - a guest whose approval never landed was never counted,
   * so only approved rows decrement.
   */
  private async cancelGuestRows(guests: EventPlayerDocument[]) {
    if (!guests.length) return;

    const approved = guests.filter((g) => g.approval === 'approved').length;

    await this.playerModel.updateMany(
      { _id: { $in: guests.map((g) => g._id) } },
      { $set: { status: 'cancelled' } },
    );

    if (approved > 0) {
      await this.eventModel.updateOne(
        { _id: guests[0].eventId, joinedCount: { $gte: approved } },
        { $inc: { joinedCount: -approved } },
      );
    }
  }

  /**
   * Removes the guests a departing member brought.
   *
   * A guest exists only as somebody's plus-one: with their sponsor gone there
   * is nobody vouching for them, nobody paying for them (the sponsor covers a
   * guest by decision), and nobody to arrive with. Leaving them on the roster
   * would quietly convert them into an unattached player.
   *
   * Called from both exits - the member leaving of their own accord, and an
   * organizer removing them.
   */
  private async cascadeGuestsOfSponsor(eventId: string, sponsorId: string) {
    const guests = await this.playerModel.find({
      eventId: new Types.ObjectId(eventId),
      addedByUserId: new Types.ObjectId(sponsorId),
      status: 'joined',
    });
    await this.cancelGuestRows(guests);
    return guests.length;
  }

  // --- Payments -----------------------------------------------------------

  /**
   * Payment rows for an event.
   *
   * Role-aware rather than two routes: an organizer gets every member's status
   * because they are the one collecting, and anyone else gets only their own
   * row — a member has no business reading who else has paid.
   *
   * Members with no row yet are absent rather than synthesised as unpaid. The
   * caller knows the roster from `GET /events/:id/players`; inventing rows here
   * would blur "not recorded" with "recorded as unpaid".
   */
  async listPayments(eventId: string, userId: string) {
    const event = await this.eventModel.findById(eventId).select('_id').lean();
    if (!event) throw new NotFoundException('Event not found');

    const isOrganizer = await this.isOrganizer(eventId, userId);
    const filter: Record<string, unknown> = { eventId: event._id };
    if (!isOrganizer) filter.memberId = new Types.ObjectId(userId);

    return this.paymentModel
      .find(filter)
      .populate('memberId', 'name username displayName profileImage')
      .sort({ createdAt: 1 })
      .lean();
  }

  /**
   * Record whether one member has paid. Organizer only.
   *
   * Upserts, so the first call for a member creates the row — there is no
   * separate "open the payment sheet" step, and a member who never appears
   * simply has no record.
   *
   * `paidAt` tracks the transition rather than the write: it is stamped when
   * `isPaid` becomes true and cleared when a payment is reversed, so it can
   * never read as a payment date for someone currently unpaid.
   */
  async setPayment(
    eventId: string,
    requesterId: string,
    memberId: string,
    dto: SetPaymentDto,
  ) {
    await this.assertOrganizer(eventId, requesterId);

    if (!Types.ObjectId.isValid(memberId)) {
      throw new BadRequestException('Invalid member id');
    }

    // Only someone actually on the roster can owe for the event.
    const player = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(memberId),
      status: 'joined',
    });
    if (!player) {
      throw new NotFoundException('That member has not joined this event');
    }

    const updated = await this.paymentModel.findOneAndUpdate(
      {
        eventId: new Types.ObjectId(eventId),
        memberId: new Types.ObjectId(memberId),
      },
      {
        $set: {
          isPaid: dto.isPaid,
          paidAt: dto.isPaid ? new Date() : null,
          recordedBy: new Types.ObjectId(requesterId),
        },
      },
      { new: true, upsert: true },
    );

    return updated;
  }

  // --- Team member roles ---------------------------------------------------

  /**
   * Set one player's role within one team.
   *
   * Owner, admin or group captain. Only meaningful once players are assigned,
   * so the target must already be in `team.players` — a role on someone who is
   * not in the squad would be invisible and would linger if they never joined.
   *
   * `player` is the default and is stored as ABSENCE: setting it removes the
   * entry rather than writing `role: 'player'`. That keeps one representation
   * for the common case, so a player cannot be both absent and explicitly
   * default at once.
   */
  async setTeamMemberRole(
    eventId: string,
    teamId: string,
    targetUserId: string,
    requesterId: string,
    dto: SetTeamMemberRoleDto,
  ) {
    const event = await this.assertOrganizer(
      eventId,
      requesterId,
      TEAM_ROLE_MANAGER_ROLES,
    );
    if (!canModify(event.status)) {
      throw new BadRequestException(
        'This event is archived; team roles can no longer be changed',
      );
    }

    if (!Types.ObjectId.isValid(teamId)) {
      throw new BadRequestException('Invalid team id');
    }
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException('Invalid user id');
    }

    const team = await this.teamModel.findOne({
      _id: new Types.ObjectId(teamId),
      eventId: new Types.ObjectId(eventId),
    });
    if (!team) throw new NotFoundException('Team not found for this event');

    const isInSquad = team.players.some(
      (playerId) => playerId.toString() === targetUserId,
    );
    if (!isInSquad) {
      throw new BadRequestException(
        'That player is not in this team — assign them first',
      );
    }

    // Drop any existing entry, then re-add only if the role is non-default.
    team.playerRoles = team.playerRoles.filter(
      (entry) => entry.userId.toString() !== targetUserId,
    );
    if (dto.role !== DEFAULT_TEAM_MEMBER_ROLE) {
      team.playerRoles.push({
        userId: new Types.ObjectId(targetUserId),
        role: dto.role,
      });
    }
    await team.save();

    return {
      message: `Role updated to '${dto.role}'`,
      teamId: String(team._id),
      userId: targetUserId,
      role: dto.role,
    };
  }

  /** True when the caller may act as the event's organizer, without throwing. */
  private async isOrganizer(eventId: string, userId: string): Promise<boolean> {
    try {
      await this.assertOrganizer(eventId, userId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The match length already scheduled for an event, or `null` if none is.
   *
   * Read from the fixtures rather than the teams, which is where it used to
   * live. Returns the first fixture's value: generation writes one duration
   * across the whole schedule, and reading one row keeps this cheap.
   */
  private async scheduledMatchDuration(
    eventId: string,
  ): Promise<number | null> {
    const first = await this.matchModel
      .findOne({ eventId: new Types.ObjectId(eventId) })
      .select('duration')
      .sort({ matchNumber: 1 })
      .lean();
    return first?.duration ?? null;
  }

  /**
   * Roster-row ids of the APPROVED guests on an event, oldest first.
   *
   * The guest counterpart to `joinedPlayerIds`. Returns roster-row ids rather
   * than user ids because a guest has no user account — those ids are what
   * `team.guests` holds.
   */
  private async approvedGuestIds(eventId: string): Promise<string[]> {
    const guests = await this.playerModel
      .find({
        eventId: new Types.ObjectId(eventId),
        type: 'guest',
        status: 'joined',
        approval: 'approved',
      })
      .select('_id')
      .sort({ joinedAt: 1 })
      .lean();
    return guests.map((guest) => String(guest._id));
  }

  /** Event ids the caller is currently on the roster of (a left event is not one). */
  private async joinedEventIds(userId: string): Promise<unknown[]> {
    // The id comes from the verified token, so a malformed one means something
    // upstream is broken — but a roster row can only ever key on a real
    // ObjectId, so the honest answer is "no joined events" rather than letting
    // the driver throw a BSONError up as a 500.
    if (!Types.ObjectId.isValid(userId)) return [];

    const rows = await this.playerModel
      .find({
        userId: new Types.ObjectId(userId),
        // A cancelled row survives for reactivation, so filter on the status
        // rather than mere presence — otherwise an event you left comes back.
        status: 'joined',
      })
      .select('eventId')
      .lean();
    return rows.map((row) => row.eventId);
  }

  /**
   * User ids of the REGISTERED players on the roster, oldest first.
   *
   * Guests are EXCLUDED. These ids flow into `team.players`, which references
   * `User`, and into notifications — a guest has neither an account to
   * reference nor a device to notify, and a guest row carries no `userId` at
   * all, so including them here would dereference undefined.
   *
   * Phrased as `type: { $ne: 'guest' }` rather than `type: 'registered'`, for
   * the same reason `PLAYABLE_APPROVAL` is an exclusion: `type` was added with
   * a default, and Mongoose defaults apply on WRITE, not on read. Every roster
   * row created before that field existed has no `type` at all, so a positive
   * match found none of them and shuffle reported an empty roster on every
   * pre-existing event.
   */
  private async joinedPlayerIds(eventId: string): Promise<string[]> {
    const players = await this.playerModel
      .find({
        eventId: new Types.ObjectId(eventId),
        status: 'joined',
        type: { $ne: 'guest' },
        approval: PLAYABLE_APPROVAL,
      })
      .select('userId')
      .sort({ joinedAt: 1 })
      .lean();
    return players
      .filter((player) => player.userId)
      .map((player) => String(player.userId));
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

/** Default page size for `search`, when the caller supplies none. */
const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Clamps a caller-supplied page size into 1-50, falling back to `fallback`.
 *
 * `?limit=abc` reaches us as NaN, and a bare Math.min/Math.max clamp cannot
 * reject it — every comparison against NaN is false, so the NaN flows straight
 * through to Mongoose's .limit(). Hence the explicit isFinite check.
 */
function clampLimit(limit: number, fallback = DEFAULT_SEARCH_LIMIT): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 50);
}
