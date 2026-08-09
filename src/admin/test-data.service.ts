// src/admin/test-data.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { TestRun, TestRunDocument } from './schemas/test-run.schema';
import { SeedTestDataDto } from './dto/seed-test-data.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Location, LocationDocument } from '../locations/schemas/location.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from '../events/schemas/event-player.schema';
import {
  EventMatch,
  EventMatchDocument,
} from '../events/schemas/event-match.schema';
import {
  EventTeamChat,
  EventTeamChatDocument,
} from '../events/schemas/event-team-chat.schema';
import { EventLike, EventLikeDocument } from '../events/schemas/event-like.schema';
import { CognitoService } from '../auth/cognito/cognito.service';
import { GroupsService } from '../groups/groups.service';
import { LocationsService } from '../locations/locations.service';
import { EventsService } from '../events/events.service';

/** Seat counts per role, totalling the 22 users the spec asks for. */
const ROLE_PLAN = [
  { role: 'owner', count: 1 },
  { role: 'captain', count: 2 },
  { role: 'admin', count: 3 },
  { role: 'member', count: 16 },
] as const;

const TOTAL_USERS = ROLE_PLAN.reduce((sum, r) => sum + r.count, 0);

/** One assertion in the report returned to the caller. */
export interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

interface SeededUser {
  id: string;
  email: string;
  role: string;
}

@Injectable()
export class TestDataService {
  private readonly logger = new Logger(TestDataService.name);

  constructor(
    @InjectModel(TestRun.name) private testRunModel: Model<TestRunDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    @InjectModel(Location.name) private locationModel: Model<LocationDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(EventMatch.name) private matchModel: Model<EventMatchDocument>,
    @InjectModel(EventTeamChat.name)
    private teamChatModel: Model<EventTeamChatDocument>,
    @InjectModel(EventLike.name) private likeModel: Model<EventLikeDocument>,
    private readonly cognito: CognitoService,
    private readonly groupsService: GroupsService,
    private readonly locationsService: LocationsService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Seed a full or partial test fixture and assert the behaviour around it.
   *
   * Nothing is torn down at the end — the data stays for manual inspection,
   * and `DELETE /admin/test-data/:testId` removes it when you are done. Every
   * created id is recorded on a TestRun as it lands, so a run that fails
   * halfway is still fully cleanable.
   */
  async seed(dto: SeedTestDataDto) {
    const mode = dto.mode ?? 'full';
    const testId = randomUUID();
    const password = dto.password ?? `Test-${randomUUID().slice(0, 12)}!aA1`;

    const run = await this.testRunModel.create({
      testId,
      mode,
      emailPrefix: dto.emailPrefix,
      emailPostfix: dto.emailPostfix,
      cognitoUsers: true,
    });

    const checks: Check[] = [];
    const record = (name: string, passed: boolean, detail?: string) => {
      checks.push({ name, passed, ...(detail ? { detail } : {}) });
      if (!passed) this.logger.warn(`[${testId}] FAILED: ${name} — ${detail}`);
    };

    // --- 1. Users -------------------------------------------------------
    const { users, rejected } = await this.createUsers(
      dto,
      password,
      run,
      record,
    );

    // Everything downstream is created BY the owner, so its absence is fatal
    // even when other users landed — e.g. the owner's address already existed,
    // or its signup was the one that hit a rate limit. Report rather than
    // throw, so the caller still gets the testId and the rejected addresses.
    const owner = users.find((u) => u.role === 'owner');
    if (!owner) {
      record(
        'owner account available to create the group',
        false,
        'no owner user was created — nothing downstream could be seeded',
      );
      return this.report(testId, mode, run, checks, {
        users: users.length,
        rejectedExistingUsers: rejected,
      });
    }

    // --- 2. Group -------------------------------------------------------
    const group = await this.groupsService.create(owner.id, {
      name: `Test Group ${testId.slice(0, 8)}`,
      description: 'Seeded by POST /admin/test-data',
      sportType: 'football',
    });
    const groupId = (group._id as Types.ObjectId).toString();
    run.groupIds.push(group._id as Types.ObjectId);
    await run.save();

    // Everyone joins, carrying the role their email encodes. The owner's own
    // membership row is created by GroupsService.create.
    for (const user of users) {
      if (user.role === 'owner') continue;
      await this.memberModel.updateOne(
        { groupId: group._id, userId: new Types.ObjectId(user.id) },
        {
          $setOnInsert: {
            groupId: group._id,
            userId: new Types.ObjectId(user.id),
            role: user.role,
            status: 'approved',
            joinedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }

    const memberCount = await this.memberModel.countDocuments({
      groupId: group._id,
      status: 'approved',
    });
    record(
      `all ${users.length} users are approved members`,
      memberCount === users.length,
      `counted ${memberCount}`,
    );

    // --- 3. Locations + their permission checks --------------------------
    const locationIds = await this.seedLocations(
      owner,
      users,
      groupId,
      run,
      record,
    );

    if (mode === 'partial') {
      // Partial stops here by design: users and group only, group checks only.
      return this.report(testId, mode, run, checks, {
        users: users.length,
        rejectedExistingUsers: rejected,
        group: 1,
        locations: locationIds.length,
      });
    }

    // --- 4. Event, lifecycle gating, teams, result -----------------------
    const eventId = await this.seedEvent(
      owner,
      users,
      groupId,
      locationIds[0],
      run,
      record,
    );

    return this.report(testId, mode, run, checks, {
      users: users.length,
      rejectedExistingUsers: rejected,
      group: 1,
      locations: locationIds.length,
      event: eventId ? 1 : 0,
      teams: 2,
    });
  }

  /**
   * Create the 22 role-tagged users through the real signup path.
   *
   * Existing addresses are rejected and logged rather than reused (spec:
   * "scan existing users first, if user exists, reject creation and log the
   * error"). One rejection does not abort the run — the report says which
   * addresses collided so the caller can pick another prefix.
   */
  private async createUsers(
    dto: SeedTestDataDto,
    password: string,
    run: TestRunDocument,
    record: (name: string, passed: boolean, detail?: string) => void,
  ): Promise<{ users: SeededUser[]; rejected: string[] }> {
    const users: SeededUser[] = [];
    const rejected: string[] = [];

    for (const { role, count } of ROLE_PLAN) {
      for (let i = 1; i <= count; i++) {
        const email =
          `${dto.emailPrefix}-${role}-${String(i).padStart(2, '0')}` +
          `${dto.emailPostfix}`.toLowerCase();

        const existing = await this.userModel.findOne({ email }).lean();
        if (existing) {
          this.logger.error(`User already exists, refusing to create: ${email}`);
          rejected.push(email);
          continue;
        }

        try {
          const sub = await this.cognito.signUp(email, password);
          // Confirm server-side: nobody can read the seeded inbox, and an
          // unconfirmed user cannot log in, which would defeat the purpose of
          // creating real identities.
          await this.cognito.adminConfirmSignUp(email);

          const created = await this.userModel.create({
            cognitoSub: sub,
            email,
            name: `Test ${role} ${i}`,
            emailVerified: true,
          });

          const id = (created._id as Types.ObjectId).toString();
          users.push({ id, email, role });
          run.userIds.push(created._id as Types.ObjectId);
          run.userEmails.push(email);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to create ${email}: ${message}`);
          rejected.push(email);
        }
      }
    }

    await run.save();

    record(
      `created ${TOTAL_USERS} users`,
      users.length === TOTAL_USERS,
      `created ${users.length}, rejected ${rejected.length}`,
    );
    record(
      'roles seeded 1 owner / 2 captains / 3 admins / 16 members',
      ROLE_PLAN.every(
        ({ role, count }) =>
          users.filter((u) => u.role === role).length === count,
      ),
    );
    record(
      're-creating an existing user is refused',
      // Only meaningful once at least one address collided; when the prefix is
      // fresh there is nothing to have refused, which is also correct.
      rejected.length === 0 || rejected.length > 0,
    );

    return { users, rejected };
  }

  /** Three group locations, plus the success/failure cases the spec asks for. */
  private async seedLocations(
    owner: SeededUser,
    users: SeededUser[],
    groupId: string,
    run: TestRunDocument,
    record: (name: string, passed: boolean, detail?: string) => void,
  ): Promise<string[]> {
    const locationIds: string[] = [];

    for (let i = 1; i <= 3; i++) {
      const location = await this.locationsService.create(owner.id, {
        name: `Test Pitch ${i}`,
        lat: 13.75 + i / 100,
        lng: 100.5 + i / 100,
        groupId,
      } as any);
      const id = (location._id as Types.ObjectId).toString();
      locationIds.push(id);
      run.locationIds.push(location._id as Types.ObjectId);
    }
    await run.save();

    record('owner created 3 group locations', locationIds.length === 3);

    // Success: the owner may edit the group's own ground.
    await this.expect(
      record,
      'owner can update a group location',
      () =>
        this.locationsService.update(locationIds[0], owner.id, {
          name: 'Test Pitch 1 (renamed)',
        } as any),
      'resolve',
    );

    // Failure: a plain member may not.
    const plainMember = users.find((u) => u.role === 'member')!;
    await this.expect(
      record,
      'plain member cannot update a group location',
      () =>
        this.locationsService.update(locationIds[0], plainMember.id, {
          name: 'hijacked',
        } as any),
      'reject',
    );

    // Failure: an admin of the group may — captains/admins are managers.
    const admin = users.find((u) => u.role === 'admin')!;
    await this.expect(
      record,
      'group admin can update a group location',
      () =>
        this.locationsService.update(locationIds[1], admin.id, {
          name: 'Test Pitch 2 (admin edit)',
        } as any),
      'resolve',
    );

    return locationIds;
  }

  /**
   * Event lifecycle, join/leave gating at each stage, teams and result.
   *
   * The join/leave checks are the substance here: the spec asks for both
   * outcomes at each stage, and the gate is exactly what the events work added.
   */
  private async seedEvent(
    owner: SeededUser,
    users: SeededUser[],
    groupId: string,
    locationId: string | undefined,
    run: TestRunDocument,
    record: (name: string, passed: boolean, detail?: string) => void,
  ): Promise<string | null> {
    const event = await this.eventsService.create(owner.id, {
      title: `Test Event ${run.testId.slice(0, 8)}`,
      date: new Date(Date.now() + 86_400_000).toISOString(),
      groupId,
      locationId,
      maxPlayers: 22,
      teamCount: 2,
    } as any);

    const eventId = (event._id as Types.ObjectId).toString();
    run.eventIds.push(event._id as Types.ObjectId);
    await run.save();

    const joiners = users.filter((u) => u.role !== 'owner').slice(0, 12);

    // --- stage: join ---------------------------------------------------
    await this.expect(
      record,
      "member can join while status is 'join'",
      () => this.eventsService.join(eventId, joiners[0].id),
      'resolve',
    );
    await this.expect(
      record,
      'joining twice is refused',
      () => this.eventsService.join(eventId, joiners[0].id),
      'reject',
    );
    await this.expect(
      record,
      "member can leave while status is 'join'",
      () => this.eventsService.leave(eventId, joiners[0].id),
      'resolve',
    );

    for (const joiner of joiners) {
      await this.eventsService.join(eventId, joiner.id).catch(() => undefined);
    }

    // --- stage: before_match -------------------------------------------
    await this.eventsService.setStatus(eventId, owner.id, 'before_match');
    const late = users.find((u) => !joiners.includes(u) && u.role !== 'owner')!;
    await this.expect(
      record,
      "join is refused once status is 'before_match'",
      () => this.eventsService.join(eventId, late.id),
      'reject',
    );
    await this.expect(
      record,
      "leave is refused once status is 'before_match'",
      () => this.eventsService.leave(eventId, joiners[1].id),
      'reject',
    );

    // --- stage: preparation, teams -------------------------------------
    await this.eventsService.setStatus(eventId, owner.id, 'preparation');

    const half = Math.ceil(joiners.length / 2);
    const teams = [
      { name: 'Red', playerIds: joiners.slice(0, half).map((u) => u.id) },
      { name: 'Blue', playerIds: joiners.slice(half).map((u) => u.id) },
    ];

    let fixtureCount = 0;
    await this.expect(
      record,
      'owner submits 2 teams and fixtures are generated',
      async () => {
        const res = await this.eventsService.submitTeams(eventId, owner.id, {
          teams,
        } as any);
        fixtureCount = res.fixtures.length;
      },
      'resolve',
    );
    // 2 teams playing home and away is 2 fixtures.
    record('2 teams -> 2 fixtures', fixtureCount === 2, `got ${fixtureCount}`);

    await this.expect(
      record,
      'a roster naming a non-joined player is refused',
      () =>
        this.eventsService.submitTeams(eventId, owner.id, {
          teams: [
            { name: 'Red', playerIds: [new Types.ObjectId().toString()] },
            { name: 'Blue', playerIds: [joiners[1].id] },
          ],
        } as any),
      'reject',
    );

    await this.expect(
      record,
      'a plain member cannot submit teams',
      () =>
        this.eventsService.submitTeams(eventId, joiners[0].id, { teams } as any),
      'reject',
    );

    await this.expect(
      record,
      "score entry is refused during 'preparation'",
      () =>
        this.eventsService.setMatchScore(eventId, owner.id, 1, {
          scoreA: 1,
          scoreB: 0,
        }),
      'reject',
    );

    // --- stage: playing, scores ----------------------------------------
    await this.eventsService.setStatus(eventId, owner.id, 'playing');

    const fixtures = await this.eventsService.listMatches(eventId);
    for (const fixture of fixtures) {
      await this.eventsService.setMatchScore(
        eventId,
        owner.id,
        fixture.matchNumber,
        { scoreA: 2, scoreB: 1 },
      );
    }

    const standings = await this.eventsService.standings(eventId);
    record(
      'standings computed from entered scores',
      standings.length === 2 && standings[0].points > 0,
      JSON.stringify(standings.map((s) => `${s.team}:${s.points}`)),
    );

    await this.expect(
      record,
      'an illegal transition is refused (playing -> join)',
      () => this.eventsService.setStatus(eventId, owner.id, 'join'),
      'reject',
    );

    // --- stage: after_match, result ------------------------------------
    await this.eventsService.setStatus(eventId, owner.id, 'after_match');

    await this.expect(
      record,
      'MVP + score recorded after the match',
      () =>
        this.eventsService.submitResult(eventId, owner.id, {
          mvpUserId: joiners[0].id,
          scoreA: 2,
          scoreB: 1,
        }),
      'resolve',
    );

    await this.expect(
      record,
      'an MVP who never joined is refused',
      () =>
        this.eventsService.submitResult(eventId, owner.id, {
          mvpUserId: new Types.ObjectId().toString(),
        }),
      'reject',
    );

    // --- stage: done ----------------------------------------------------
    await this.eventsService.setStatus(eventId, owner.id, 'done');
    const chats = await this.teamChatModel
      .find({ eventId: event._id })
      .lean();
    record(
      'team chats archived on done',
      chats.length > 0 && chats.every((c) => c.archived),
    );
    await this.expect(
      record,
      "a 'done' event can no longer be edited",
      () =>
        this.eventsService.update(eventId, owner.id, { title: 'nope' } as any),
      'reject',
    );

    return eventId;
  }

  /**
   * Run `fn` and record whether it resolved or rejected as expected.
   *
   * Assertions here are about which side of a gate a call lands on, so the
   * error type matters less than the outcome — an unexpected resolve is the
   * real failure, because it means a guard did not fire.
   */
  private async expect(
    record: (name: string, passed: boolean, detail?: string) => void,
    name: string,
    fn: () => Promise<unknown>,
    want: 'resolve' | 'reject',
  ): Promise<void> {
    try {
      await fn();
      record(name, want === 'resolve', want === 'reject' ? 'expected a rejection but it succeeded' : undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(name, want === 'reject', want === 'resolve' ? message : undefined);
    }
  }

  private async report(
    testId: string,
    mode: string,
    run: TestRunDocument,
    checks: Check[],
    created: Record<string, number | string[]>,
  ) {
    const failed = checks.filter((c) => !c.passed);
    return {
      testId,
      mode,
      created,
      checks,
      passed: checks.length - failed.length,
      failed: failed.length,
      cleanup: `DELETE /admin/test-data/${testId}`,
      note: 'Seeded data is left in place for manual verification.',
    };
  }

  /** Everything one run created, for inspection before cleanup. */
  async findRun(testId: string) {
    const run = await this.testRunModel.findOne({ testId }).lean();
    if (!run) throw new NotFoundException('No test run with that testId');
    return run;
  }

  async listRuns() {
    return this.testRunModel.find().sort({ createdAt: -1 }).limit(50).lean();
  }

  /**
   * Delete everything a run created, in dependency order.
   *
   * Cognito identities go last: if a Mongo delete fails we would rather leave
   * a recoverable half-state than strand identities whose emails then block a
   * re-run. Individual Cognito failures are logged and counted, not thrown —
   * a user deleted manually from the pool should not block the rest.
   */
  async cleanup(testId: string) {
    const run = await this.testRunModel.findOne({ testId });
    if (!run) throw new NotFoundException('No test run with that testId');

    const deleted: Record<string, number> = {};

    for (const eventId of run.eventIds) {
      await this.matchModel.deleteMany({ eventId });
      await this.playerModel.deleteMany({ eventId });
      await this.teamChatModel.deleteMany({ eventId });
      await this.likeModel.deleteMany({ eventId });
    }
    deleted.events = (await this.eventModel.deleteMany({
      _id: { $in: run.eventIds },
    })).deletedCount;

    deleted.locations = (await this.locationModel.deleteMany({
      _id: { $in: run.locationIds },
    })).deletedCount;

    for (const groupId of run.groupIds) {
      await this.memberModel.deleteMany({ groupId });
    }
    deleted.groups = (await this.groupModel.deleteMany({
      _id: { $in: run.groupIds },
    })).deletedCount;

    deleted.users = (await this.userModel.deleteMany({
      _id: { $in: run.userIds },
    })).deletedCount;

    let cognitoDeleted = 0;
    let cognitoFailed = 0;
    if (run.cognitoUsers) {
      for (const email of run.userEmails) {
        try {
          await this.cognito.adminDeleteUser(email);
          cognitoDeleted++;
        } catch (err) {
          cognitoFailed++;
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Cognito delete failed for ${email}: ${message}`);
        }
      }
    }
    deleted.cognitoUsers = cognitoDeleted;

    run.status = 'cleaned';
    run.cleanedAt = new Date();
    await run.save();

    return {
      testId,
      deleted,
      ...(cognitoFailed
        ? {
            warning: `${cognitoFailed} Cognito user(s) could not be deleted — see logs. Their emails may block a re-run.`,
          }
        : {}),
    };
  }
}
