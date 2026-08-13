// src/admin/test-data.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
import {
  cognitoErrorName,
  isCognitoThrottle,
} from '../auth/cognito/cognito.errors';
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

/**
 * Outcome of the user-seeding pass.
 *
 * `alreadyExisted` and `failures` are kept apart because they mean opposite
 * things: the first is the endpoint behaving as specified (refusing to reuse an
 * address), the second is something wrong upstream. Reporting both as
 * "rejected" once made a password-policy rejection and an AWS throttle both
 * read as "user already exists", which is exactly backwards.
 */
interface CreateUsersResult {
  users: SeededUser[];
  alreadyExisted: string[];
  failures: { email: string; error: string; awsError?: string }[];
}

/**
 * Pause between signup calls, and the retry schedule when AWS throttles.
 *
 * Cognito rate-limits SignUp per app client. 22 calls fired back-to-back get
 * refused partway through — and a throttled request carrying a SECRET_HASH
 * comes back as NotAuthorizedException, not TooManyRequestsException, so it
 * looks like a credentials problem. Pacing the loop avoids provoking it;
 * the backoff handles the burst limit still being hit.
 */
// Overridable so unit tests can exercise the retry path without waiting out
// the real backoff. Production never sets this.
const FAST = process.env.TEST_DATA_NO_DELAY === '1';
const SIGNUP_GAP_MS = FAST ? 0 : 120;
const SIGNUP_RETRY_DELAYS_MS = FAST ? [0, 0, 0] : [500, 1500, 4000];

/**
 * Give up on the whole pass after this many failures with nothing created.
 * A bad secret or a rejected password fails for every address identically, so
 * continuing only delays the diagnosis.
 */
const ABORT_AFTER_FAILURES = 3;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    const password = dto.password ?? generatePassword();

    // Fail fast on a password the default Cognito policy would reject. Without
    // this the same violation is discovered 22 times, once per signup, and only
    // in the log — which is exactly how a missing uppercase character turned
    // into a long debugging session.
    const weakness = describePasswordWeakness(password);
    if (weakness) {
      throw new BadRequestException(
        `password will be rejected by Cognito: ${weakness}`,
      );
    }

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
    const { users, alreadyExisted, failures } = await this.createUsers(
      dto,
      password,
      run,
      record,
    );

    // Reported separately so a config/throttle problem is never mistaken for a
    // name collision — the two need completely different fixes.
    const userOutcome = {
      users: users.length,
      alreadyExisted,
      failed: failures,
    };

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
      return this.report(testId, mode, run, checks, userOutcome);
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
        ...userOutcome,
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
      ...userOutcome,
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
  ): Promise<CreateUsersResult> {
    const users: SeededUser[] = [];
    const alreadyExisted: string[] = [];
    const failures: CreateUsersResult['failures'] = [];

    let first = true;
    let aborted = false;
    for (const { role, count } of ROLE_PLAN) {
      for (let i = 1; i <= count; i++) {
        // Parenthesised: `.toLowerCase()` binds tighter than `+`, so applying
        // it to only the postfix literal would leave a mixed-case prefix.
        const email = (
          `${dto.emailPrefix}-${role}-${String(i).padStart(2, '0')}` +
          dto.emailPostfix
        ).toLowerCase();

        const existing = await this.userModel.findOne({ email }).lean();
        if (existing) {
          // A warning, not an error: refusing to reuse an address is this
          // endpoint working as specified.
          this.logger.warn(`User already exists, refusing to create: ${email}`);
          alreadyExisted.push(email);
          continue;
        }

        // Pace the loop. Skipped before the first call so a single-user run
        // pays nothing.
        if (!first) await sleep(SIGNUP_GAP_MS);
        first = false;

        try {
          const sub = await this.signUpWithRetry(email, password);
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
          const error = err instanceof Error ? err.message : String(err);
          const awsError = cognitoErrorName(err);
          this.logger.error(
            `Failed to create ${email}: ${error}` +
              (awsError ? ` [${awsError}]` : ''),
          );
          failures.push({ email, error, ...(awsError ? { awsError } : {}) });

          // Bail out early on a systemic failure rather than repeating it 22
          // times — the caller gets the same diagnosis in a fraction of the
          // time. Only when NOTHING has succeeded: a single transient failure
          // among successes is not systemic.
          if (TestDataService.shouldAbortSeeding(failures, users.length)) {
            this.logger.error(
              `Aborting user seeding after ${failures.length} consecutive ` +
                `failures — every signup is failing the same way: ${error}`,
            );
            aborted = true;
          }
        }
        if (aborted) break;
      }
      if (aborted) break;
    }

    await run.save();

    // Put the actual reason in the RESPONSE, not just the log. Failures here
    // almost always share one cause, so the first message is the useful one.
    const firstFailure = failures[0];
    record(
      `created ${TOTAL_USERS} users`,
      users.length === TOTAL_USERS,
      `created ${users.length}, ${alreadyExisted.length} already existed, ` +
        `${failures.length} failed` +
        (firstFailure
          ? ` — first error: ${firstFailure.error}` +
            (firstFailure.awsError ? ` [${firstFailure.awsError}]` : '')
          : ''),
    );
    record(
      'roles seeded 1 owner / 2 captains / 3 admins / 16 members',
      ROLE_PLAN.every(
        ({ role, count }) =>
          users.filter((u) => u.role === role).length === count,
      ),
    );

    // Assert the refusal only when there was something to refuse. The previous
    // version asserted `rejected.length === 0 || rejected.length > 0` — true for
    // every possible input, so it could never fail and never told anyone
    // anything.
    if (alreadyExisted.length) {
      record(
        'an existing address is refused rather than reused',
        users.every((u) => !alreadyExisted.includes(u.email)),
        `${alreadyExisted.length} address(es) already in use — ` +
          'pick a fresh emailPrefix, or clean up the run that owns them',
      );
    }
    if (failures.length) {
      record(
        'every signup reached the identity provider',
        false,
        `${failures.length} failed. First: ${firstFailure.error}` +
          (firstFailure.awsError ? ` [${firstFailure.awsError}]` : ''),
      );
    }

    return { users, alreadyExisted, failures };
  }

  /**
   * `cognito.signUp` with backoff when AWS throttles.
   *
   * Only throttling is retried. A policy violation or an existing username
   * fails identically however many times it is tried, so retrying those would
   * just multiply the wait before reporting.
   */
  private async signUpWithRetry(
    email: string,
    password: string,
  ): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.cognito.signUp(email, password);
      } catch (err) {
        // ONLY genuine throttling is retried.
        //
        // NotAuthorizedException is deliberately excluded even though a
        // throttled SECRET_HASH request can present that way: it is far more
        // often a misconfigured client secret, and retrying then turns a fast,
        // clear failure into 22 × 6s of waiting before the same answer. The
        // per-call gap below is what avoids provoking the rate limit; backoff
        // handles the burst case.
        if (!isCognitoThrottle(err) || attempt >= SIGNUP_RETRY_DELAYS_MS.length) {
          throw err;
        }

        const delay = SIGNUP_RETRY_DELAYS_MS[attempt];
        this.logger.warn(
          `Signup for ${email} throttled (attempt ${attempt + 1}); ` +
            `retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }

  /**
   * Stop the whole pass once it is clear every signup will fail the same way.
   *
   * A bad client secret or a pool policy the password violates fails
   * identically for all 22 addresses. Grinding through the rest produces 21
   * more copies of one message and delays the answer.
   */
  private static shouldAbortSeeding(
    failures: CreateUsersResult['failures'],
    created: number,
  ): boolean {
    return created === 0 && failures.length >= ABORT_AFTER_FAILURES;
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
    // Two-step flow: generate the empty teams and the schedule, then assign.
    // Deliberately `any`: it is assigned inside a closure, and TS narrows the
    // declared union to `never` at the later read sites.
    let generated: any = null;
    await this.expect(
      record,
      'owner generates 2 teams and a fixture list',
      async () => {
        generated = (await this.eventsService.generateTeams(eventId, owner.id, {
          teamsCount: 2,
          duration: 30,
        })) as any;
      },
      'resolve',
    );

    // The event is seeded with duration 90, so (90 - 10) / 30 floors to 2.
    record(
      'match count derives from event duration',
      generated?.matchCount === 2,
      `got ${generated?.matchCount}`,
    );
    record(
      'generated teams start empty',
      (generated?.teams ?? []).every((t: any) => (t.players ?? []).length === 0),
    );

    const teamIds = (generated?.teams ?? []).map((t: any) => String(t._id));

    await this.expect(
      record,
      'owner assigns players to a generated team',
      () =>
        this.eventsService.assignTeamPlayers(eventId, teamIds[0], owner.id, {
          playerIds: joiners.slice(0, half).map((u) => u.id),
        }),
      'resolve',
    );

    await this.expect(
      record,
      'a roster naming a non-joined player is refused',
      () =>
        this.eventsService.assignTeamPlayers(eventId, teamIds[1], owner.id, {
          playerIds: [new Types.ObjectId().toString()],
        }),
      'reject',
    );

    await this.expect(
      record,
      'a player already in another team is refused',
      () =>
        this.eventsService.assignTeamPlayers(eventId, teamIds[1], owner.id, {
          playerIds: [joiners[0].id],
        }),
      'reject',
    );

    await this.expect(
      record,
      'a plain member cannot generate teams',
      () =>
        this.eventsService.generateTeams(eventId, joiners[0].id, {
          teamsCount: 2,
          duration: 30,
        }),
      'reject',
    );

    await this.expect(
      record,
      'a match longer than the event is refused',
      () =>
        this.eventsService.generateTeams(eventId, owner.id, {
          teamsCount: 2,
          duration: 500,
        }),
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
    created: Record<string, unknown>,
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

/**
 * A password satisfying the default Cognito policy: 8+ chars with an
 * uppercase, a lowercase, a digit and a symbol.
 *
 * Built from explicit character classes rather than by decorating a UUID —
 * `randomUUID()` is lowercase hex, so a template like `Test-<uuid>!aA1` leans
 * entirely on its literal parts for three of the four classes. That works until
 * someone edits the literal.
 */
function generatePassword(): string {
  const hex = randomUUID().replace(/-/g, '').slice(0, 10);
  return `Aa1!${hex.slice(0, 4).toUpperCase()}${hex.slice(4)}`;
}

/**
 * Describes why the default Cognito policy would reject `password`, or null if
 * it would pass. A pool with a custom policy may still be stricter — this
 * catches the common cases before 22 signups discover them one at a time.
 */
function describePasswordWeakness(password: string): string | null {
  const missing: string[] = [];
  if (password.length < 8) missing.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) missing.push('an uppercase letter');
  if (!/[a-z]/.test(password)) missing.push('a lowercase letter');
  if (!/[0-9]/.test(password)) missing.push('a digit');
  if (!/[^A-Za-z0-9]/.test(password)) missing.push('a symbol');
  return missing.length ? `needs ${missing.join(', ')}` : null;
}
