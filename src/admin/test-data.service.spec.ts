// src/admin/test-data.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { TestDataService } from './test-data.service';
import { TestRun } from './schemas/test-run.schema';
import { User } from '../users/schemas/user.schema';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { Location } from '../locations/schemas/location.schema';
import { Event } from '../events/schemas/event.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { EventMatch } from '../events/schemas/event-match.schema';
import { EventTeamChat } from '../events/schemas/event-team-chat.schema';
import { EventLike } from '../events/schemas/event-like.schema';
import { CognitoService } from '../auth/cognito/cognito.service';
import { GroupsService } from '../groups/groups.service';
import { LocationsService } from '../locations/locations.service';
import { EventsService } from '../events/events.service';

/** A TestRun doc double that records what the service pushes onto it. */
const runDoc = () => {
  const doc: any = {
    testId: 'test-uuid',
    userIds: [],
    userEmails: [],
    groupIds: [],
    locationIds: [],
    eventIds: [],
    cognitoUsers: true,
    status: 'created',
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
  };
  return doc;
};

describe('TestDataService', () => {
  let service: TestDataService;
  const testRunModel: any = {};
  const userModel: any = {};
  const groupModel: any = {};
  const memberModel: any = {};
  const locationModel: any = {};
  const eventModel: any = {};
  const playerModel: any = {};
  const matchModel: any = {};
  const teamChatModel: any = {};
  const likeModel: any = {};
  const cognito: any = {};
  const groups: any = {};
  const locations: any = {};
  const events: any = {};

  const deleteResult = (n: number) => ({ deletedCount: n });

  beforeEach(async () => {
    jest.clearAllMocks();

    testRunModel.create = jest.fn().mockResolvedValue(runDoc());
    testRunModel.findOne = jest.fn();
    testRunModel.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });

    userModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    userModel.create = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ _id: new Types.ObjectId() }),
      );
    userModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(22));

    groupModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(1));
    memberModel.updateOne = jest.fn().mockResolvedValue({});
    memberModel.countDocuments = jest.fn().mockResolvedValue(22);
    memberModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(22));
    locationModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(3));
    eventModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(1));
    playerModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(12));
    matchModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(2));
    teamChatModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(2));
    teamChatModel.find = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ archived: true }]),
    });
    likeModel.deleteMany = jest.fn().mockResolvedValue(deleteResult(0));

    cognito.signUp = jest.fn().mockResolvedValue('sub-1');
    cognito.adminConfirmSignUp = jest.fn().mockResolvedValue(undefined);
    cognito.adminDeleteUser = jest.fn().mockResolvedValue(undefined);

    groups.create = jest
      .fn()
      .mockResolvedValue({ _id: new Types.ObjectId() });
    locations.create = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ _id: new Types.ObjectId() }),
      );
    locations.update = jest.fn().mockResolvedValue({});

    events.create = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });
    events.join = jest.fn().mockResolvedValue({});
    events.leave = jest.fn().mockResolvedValue({});
    events.setStatus = jest.fn().mockResolvedValue({});
    events.submitTeams = jest
      .fn()
      .mockResolvedValue({ fixtures: [{}, {}], teams: [], unassignedPlayerIds: [] });
    events.listMatches = jest.fn().mockResolvedValue([{ matchNumber: 1 }]);
    events.setMatchScore = jest.fn().mockResolvedValue({});
    events.standings = jest
      .fn()
      .mockResolvedValue([{ team: 'Red', points: 3 }, { team: 'Blue', points: 0 }]);
    events.submitResult = jest.fn().mockResolvedValue({});
    events.update = jest.fn().mockResolvedValue({});

    const m = await Test.createTestingModule({
      providers: [
        TestDataService,
        { provide: getModelToken(TestRun.name), useValue: testRunModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(Location.name), useValue: locationModel },
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(EventMatch.name), useValue: matchModel },
        { provide: getModelToken(EventTeamChat.name), useValue: teamChatModel },
        { provide: getModelToken(EventLike.name), useValue: likeModel },
        { provide: CognitoService, useValue: cognito },
        { provide: GroupsService, useValue: groups },
        { provide: LocationsService, useValue: locations },
        { provide: EventsService, useValue: events },
      ],
    }).compile();
    service = m.get(TestDataService);
  });

  const seed = (over: Record<string, unknown> = {}) =>
    service.seed({
      emailPrefix: 'test',
      emailPostfix: '@example.com',
      ...over,
    } as any);

  describe('user seeding', () => {
    it('creates the 22 users the spec calls for', async () => {
      await seed();
      expect(cognito.signUp).toHaveBeenCalledTimes(22);
      expect(userModel.create).toHaveBeenCalledTimes(22);
    });

    it('splits them 1 owner / 2 captains / 3 admins / 16 members', async () => {
      await seed();
      const emails = cognito.signUp.mock.calls.map((c: any[]) => c[0]);
      const count = (role: string) =>
        emails.filter((e: string) => e.includes(`-${role}-`)).length;

      expect(count('owner')).toBe(1);
      expect(count('captain')).toBe(2);
      expect(count('admin')).toBe(3);
      expect(count('member')).toBe(16);
    });

    it('builds addresses from the supplied prefix and postfix', async () => {
      await seed({ emailPrefix: 'qa', emailPostfix: '@kickr.test' });
      expect(cognito.signUp).toHaveBeenCalledWith(
        'qa-owner-01@kickr.test',
        expect.any(String),
      );
    });

    it('confirms each user server-side so they can log in', async () => {
      // Nobody can read a seeded inbox, so an unconfirmed identity would be
      // useless — the whole point of creating real ones.
      await seed();
      expect(cognito.adminConfirmSignUp).toHaveBeenCalledTimes(22);
    });

    it('refuses an existing email instead of reusing it', async () => {
      userModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'existing' }),
      });

      const res = await seed();

      expect(cognito.signUp).not.toHaveBeenCalled();
      expect(res.created.rejectedExistingUsers).toHaveLength(22);
    });

    it('keeps going when one signup fails, reporting the address', async () => {
      // Fail a member (call 5), not the owner — the owner is seeded first and
      // its absence is handled separately below.
      cognito.signUp.mockImplementation((email: string) =>
        email.includes('member-01')
          ? Promise.reject(new Error('rate limited'))
          : Promise.resolve('sub-x'),
      );

      const res = await seed();

      // 21 of 22 still created; the failure is surfaced, not swallowed.
      expect(userModel.create).toHaveBeenCalledTimes(21);
      expect(res.created.rejectedExistingUsers).toHaveLength(1);
      expect(res.created.rejectedExistingUsers).toContain(
        'test-member-01@example.com',
      );
    });

    it('stops cleanly when the owner could not be created', async () => {
      // Everything downstream is created BY the owner, so losing it must
      // produce a report, not a TypeError.
      cognito.signUp.mockImplementation((email: string) =>
        email.includes('owner')
          ? Promise.reject(new Error('rate limited'))
          : Promise.resolve('sub-x'),
      );

      const res = await seed();

      expect(groups.create).not.toHaveBeenCalled();
      expect(res.created.group).toBeUndefined();
      const check = res.checks.find((c) => c.name.includes('owner account'));
      expect(check?.passed).toBe(false);
    });

    it('reports every check it ran', async () => {
      // With these all-permissive doubles the "must be refused" checks
      // correctly FAIL — that is the point of the report. Assert it accounts
      // for every check rather than that everything passed.
      const res = await seed();
      expect(res.checks.length).toBe(res.passed + res.failed);
      expect(res.passed).toBeGreaterThan(0);
      expect(res.cleanup).toContain('DELETE /admin/test-data/');
    });
  });

  describe('modes', () => {
    it('full mode builds the event and teams', async () => {
      const res = await seed({ mode: 'full' });
      expect(events.create).toHaveBeenCalled();
      expect(events.submitTeams).toHaveBeenCalled();
      expect(res.created.event).toBe(1);
    });

    it('partial mode stops after users, group and locations', async () => {
      const res = await seed({ mode: 'partial' });
      expect(events.create).not.toHaveBeenCalled();
      expect(res.created.group).toBe(1);
      expect(res.created.event).toBeUndefined();
    });

    it('defaults to full when no mode is given', async () => {
      await seed();
      expect(events.create).toHaveBeenCalled();
    });
  });

  describe('assertions the endpoint runs', () => {
    it('marks a check failed when a guard does not fire', async () => {
      // A plain member updating a group location must be refused; if the
      // service lets it through, the report has to say so rather than pass.
      locations.update.mockResolvedValue({});
      const res = await seed({ mode: 'partial' });

      const check = res.checks.find((c) =>
        c.name.includes('plain member cannot update'),
      );
      expect(check?.passed).toBe(false);
    });

    it('marks it passed when the guard rejects', async () => {
      locations.update.mockImplementation((_id: string, userId: string) =>
        userId ? Promise.reject(new Error('Forbidden')) : Promise.resolve({}),
      );
      const res = await seed({ mode: 'partial' });

      const check = res.checks.find((c) =>
        c.name.includes('plain member cannot update'),
      );
      expect(check?.passed).toBe(true);
    });
  });

  describe('cleanup', () => {
    const cleanableRun = () => {
      const doc = runDoc();
      doc.userIds = [new Types.ObjectId()];
      doc.userEmails = ['test-owner-01@example.com'];
      doc.groupIds = [new Types.ObjectId()];
      doc.locationIds = [new Types.ObjectId()];
      doc.eventIds = [new Types.ObjectId()];
      return doc;
    };

    it('deletes every collection the run touched', async () => {
      testRunModel.findOne.mockResolvedValue(cleanableRun());

      const res = await service.cleanup('test-uuid');

      expect(matchModel.deleteMany).toHaveBeenCalled();
      expect(playerModel.deleteMany).toHaveBeenCalled();
      expect(teamChatModel.deleteMany).toHaveBeenCalled();
      expect(likeModel.deleteMany).toHaveBeenCalled();
      expect(memberModel.deleteMany).toHaveBeenCalled();
      expect(res.deleted.users).toBe(22);
    });

    it('removes the Cognito identities too', async () => {
      // Deleting only the Mongo row would strand the pool identity, and its
      // email would then block a re-run with the same prefix.
      testRunModel.findOne.mockResolvedValue(cleanableRun());

      const res = await service.cleanup('test-uuid');

      expect(cognito.adminDeleteUser).toHaveBeenCalledWith(
        'test-owner-01@example.com',
      );
      expect(res.deleted.cognitoUsers).toBe(1);
    });

    it('warns rather than throws when a Cognito delete fails', async () => {
      testRunModel.findOne.mockResolvedValue(cleanableRun());
      cognito.adminDeleteUser.mockRejectedValue(new Error('UserNotFound'));

      const res = await service.cleanup('test-uuid');

      expect(res.warning).toMatch(/could not be deleted/);
      expect(res.deleted.cognitoUsers).toBe(0);
    });

    it('marks the run cleaned', async () => {
      const run = cleanableRun();
      testRunModel.findOne.mockResolvedValue(run);

      await service.cleanup('test-uuid');

      expect(run.status).toBe('cleaned');
      expect(run.cleanedAt).toBeInstanceOf(Date);
    });

    it('404s on an unknown testId', async () => {
      testRunModel.findOne.mockResolvedValue(null);
      await expect(service.cleanup('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findRun', () => {
    it('404s on an unknown testId', async () => {
      testRunModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      await expect(service.findRun('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
