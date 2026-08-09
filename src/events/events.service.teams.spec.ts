// src/events/events.service.teams.spec.ts
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventsService } from './events.service';
import { eventsProviders } from './events.test-providers';

const EVENT_ID = '507f1f77bcf86cd799439011';
const CREATOR = '507f191e810c19729de860ea';
const P1 = '507f191e810c19729de860e1';
const P2 = '507f191e810c19729de860e2';
const P3 = '507f191e810c19729de860e3';
const P4 = '507f191e810c19729de860e4';

const eventDoc = (over: Record<string, unknown> = {}) => {
  const doc: any = {
    _id: new Types.ObjectId(EVENT_ID),
    createdBy: new Types.ObjectId(CREATOR),
    groupId: null,
    status: 'preparation',
    teamCount: 4,
    matches: [],
    photos: [],
    result: null,
    markModified: jest.fn(),
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
    toJSON: jest.fn().mockImplementation(function (this: any) {
      const { save, toJSON, markModified, ...rest } = this;
      return rest;
    }),
    ...over,
  };
  return doc;
};

/** playerModel.find(...).select(...).sort(...).lean() -> joined players */
const joinedPlayers = (ids: string[]) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  lean: jest
    .fn()
    .mockResolvedValue(ids.map((id) => ({ userId: new Types.ObjectId(id) }))),
});

describe('EventsService — teams, fixtures, scores (spec §4.3)', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};
  const teamChatModel: any = {};
  const matchModel: any = {};
  const notifications: any = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.findById = jest.fn();
    playerModel.find = jest.fn().mockReturnValue(joinedPlayers([P1, P2, P3, P4]));
    playerModel.findOne = jest.fn().mockResolvedValue(null);
    playerModel.bulkWrite = jest.fn().mockResolvedValue({});
    memberModel.findOne = jest.fn().mockResolvedValue(null);
    teamChatModel.updateOne = jest.fn().mockResolvedValue({});
    teamChatModel.updateMany = jest.fn().mockResolvedValue({});
    matchModel.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });
    matchModel.insertMany = jest.fn().mockImplementation((rows: any[]) =>
      Promise.resolve(
        rows.map((row, i) => ({
          ...row,
          _id: `m${i + 1}`,
          toJSON: () => ({ ...row, _id: `m${i + 1}` }),
        })),
      ),
    );
    matchModel.findOneAndUpdate = jest.fn();
    matchModel.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    notifications.create = jest.fn().mockResolvedValue(undefined);

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          playerModel,
          memberModel,
          teamChatModel,
          matchModel,
          notifications,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  const submit = (teams: { name: string; playerIds: string[] }[]) =>
    service.submitTeams(EVENT_ID, CREATOR, { teams } as any);

  describe('submitTeams gating', () => {
    it.each(['join', 'before_match', 'playing', 'after_match', 'done'])(
      'rejects a submission while %s',
      async (status) => {
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(
          submit([
            { name: 'Red', playerIds: [P1] },
            { name: 'Blue', playerIds: [P2] },
          ]),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('accepts a submission during preparation', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(
        submit([
          { name: 'Red', playerIds: [P1] },
          { name: 'Blue', playerIds: [P2] },
        ]),
      ).resolves.toBeDefined();
    });

    it('rejects a roster naming a player who never joined', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const stranger = '507f191e810c19729de860ff';
      await expect(
        submit([
          { name: 'Red', playerIds: [stranger] },
          { name: 'Blue', playerIds: [P2] },
        ]),
      ).rejects.toThrow(/not a joined player/);
    });
  });

  describe('the shared persistence path (§4.3.2)', () => {
    it('generates a double round-robin from the submitted teams', async () => {
      const doc = eventDoc();
      eventModel.findById.mockResolvedValue(doc);

      const res = await submit([
        { name: 'Red', playerIds: [P1] },
        { name: 'Blue', playerIds: [P2] },
        { name: 'Green', playerIds: [P3] },
        { name: 'Black', playerIds: [P4] },
      ]);

      // 4 teams -> 12 fixtures, persisted to the eventmatches collection.
      expect(res.fixtures).toHaveLength(12);
      expect(matchModel.insertMany.mock.calls[0][0]).toHaveLength(12);
      // Every row carries its eventId so it can be found again.
      expect(
        matchModel.insertMany.mock.calls[0][0].every((r: any) => r.eventId),
      ).toBe(true);
    });

    it('persists each player onto their submitted team', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await submit([
        { name: 'Red', playerIds: [P1] },
        { name: 'Blue', playerIds: [P2] },
      ]);

      const ops = playerModel.bulkWrite.mock.calls[0][0];
      const teamFor = (id: string) =>
        ops.find((op: any) => op.updateOne.filter.userId.toString() === id)
          .updateOne.update.$set.team;

      expect(teamFor(P1)).toBe('Red');
      expect(teamFor(P2)).toBe('Blue');
    });

    it('clears the team of a joined player left off the roster', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await submit([
        { name: 'Red', playerIds: [P1] },
        { name: 'Blue', playerIds: [P2] },
      ]);

      const ops = playerModel.bulkWrite.mock.calls[0][0];
      const p3 = ops.find(
        (op: any) => op.updateOne.filter.userId.toString() === P3,
      );
      // Dropped players must fall back to null, not keep a stale team.
      expect(p3.updateOne.update.$set.team).toBeNull();
    });

    it('reports joined players left unassigned', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const res = await submit([
        { name: 'Red', playerIds: [P1] },
        { name: 'Blue', playerIds: [P2] },
      ]);

      expect(res.unassignedPlayerIds.sort()).toEqual([P3, P4].sort());
    });

    it('upserts one chat room per team', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await submit([
        { name: 'Red', playerIds: [P1] },
        { name: 'Blue', playerIds: [P2] },
      ]);

      expect(teamChatModel.updateOne).toHaveBeenCalledTimes(2);
      const teams = teamChatModel.updateOne.mock.calls.map(
        (c: any[]) => c[0].team,
      );
      expect(teams.sort()).toEqual(['Blue', 'Red']);
    });

    it('notifies only the players who were assigned', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await submit([
        { name: 'Red', playerIds: [P1] },
        { name: 'Blue', playerIds: [P2] },
      ]);

      expect(notifications.create).toHaveBeenCalledTimes(2);
      const notified = notifications.create.mock.calls.map(
        (c: any[]) => c[0].userId,
      );
      expect(notified.sort()).toEqual([P1, P2].sort());
    });

    it('regenerates fixtures on resubmission, discarding the old list', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());

      await submit([
        { name: 'Red', playerIds: [P1] },
        { name: 'Blue', playerIds: [P2] },
      ]);

      // Stale rows are deleted before the new ones land, so a shrinking or
      // renamed team cannot leave orphaned fixtures behind.
      expect(matchModel.deleteMany).toHaveBeenCalledWith({
        eventId: expect.anything(),
      });
      const inserted = matchModel.insertMany.mock.calls[0][0];
      expect(inserted).toHaveLength(2);
      expect(inserted.some((m: any) => m.teamA === 'Old')).toBe(false);
      // Delete must precede insert or the new fixtures are wiped.
      expect(matchModel.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        matchModel.insertMany.mock.invocationCallOrder[0],
      );
    });

    it('is idempotent — the same body twice leaves the same fixtures', async () => {
      const body = [
        { name: 'Red', playerIds: [P1] },
        { name: 'Blue', playerIds: [P2] },
      ];
      eventModel.findById.mockResolvedValue(eventDoc());
      const first = await submit(body);
      eventModel.findById.mockResolvedValue(eventDoc());
      const second = await submit(body);

      expect(second.fixtures).toEqual(first.fixtures);
    });
  });

  describe('shuffleTeams — the server-side fallback (§4.3.3)', () => {
    it('deals colour teams, not numeric ones', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const res = await service.shuffleTeams(EVENT_ID, CREATOR);

      // The old implementation named teams "1", "2", ... in buckets of 6.
      expect(res.teams.map((t) => t.name).sort()).toEqual(
        ['Black', 'Blue', 'Red', 'Yellow'].sort(),
      );
    });

    it('routes through the same path — fixtures and chats still happen', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const res = await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(res.fixtures).toHaveLength(12);
      expect(teamChatModel.updateOne).toHaveBeenCalledTimes(4);
    });

    it('assigns every joined player', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const res = await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(res.unassignedPlayerIds).toEqual([]);
      expect(res.teams.flatMap((t) => t.playerIds).sort()).toEqual(
        [P1, P2, P3, P4].sort(),
      );
    });

    it('caps team count at the number of players so no team is empty', async () => {
      playerModel.find.mockReturnValue(joinedPlayers([P1, P2]));
      eventModel.findById.mockResolvedValue(eventDoc({ teamCount: 4 }));

      const res = await service.shuffleTeams(EVENT_ID, CREATOR);
      expect(res.teams).toHaveLength(2);
    });

    it('refuses to shuffle fewer than two players', async () => {
      playerModel.find.mockReturnValue(joinedPlayers([P1]));
      eventModel.findById.mockResolvedValue(eventDoc());

      await expect(
        service.shuffleTeams(EVENT_ID, CREATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is gated to preparation like a client submission', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'playing' }));
      await expect(
        service.shuffleTeams(EVENT_ID, CREATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('setMatchScore', () => {
    /** The event doc only carries the lifecycle now; fixtures are their own rows. */
    const atStatus = (status = 'playing') => eventDoc({ status });

    /** findOneAndUpdate returns the updated row, or null when no fixture matched. */
    const fixtureFound = () =>
      matchModel.findOneAndUpdate.mockImplementation((_f: any, update: any) => {
        const set = update.$set;
        const row = { matchNumber: 1, teamA: 'Red', teamB: 'Blue', ...set };
        return Promise.resolve({ ...row, toJSON: () => row });
      });

    it('records both scores and stamps playedAt', async () => {
      eventModel.findById.mockResolvedValue(atStatus());
      fixtureFound();

      const match = await service.setMatchScore(EVENT_ID, CREATOR, 1, {
        scoreA: 3,
        scoreB: 2,
      });

      expect(match).toMatchObject({ scoreA: 3, scoreB: 2 });
      expect(match.playedAt).toBeInstanceOf(Date);
      // Targeted update, so concurrent scoring of different fixtures is safe.
      expect(matchModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ matchNumber: 1 }),
        expect.anything(),
        expect.objectContaining({ returnDocument: 'after' }),
      );
    });

    it('accepts a 0-0 scoreline', async () => {
      eventModel.findById.mockResolvedValue(atStatus());
      fixtureFound();
      const match = await service.setMatchScore(EVENT_ID, CREATOR, 1, {
        scoreA: 0,
        scoreB: 0,
      });
      expect(match).toMatchObject({ scoreA: 0, scoreB: 0 });
    });

    it('allows a correction after the whistle', async () => {
      eventModel.findById.mockResolvedValue(atStatus('after_match'));
      fixtureFound();
      await expect(
        service.setMatchScore(EVENT_ID, CREATOR, 1, { scoreA: 1, scoreB: 0 }),
      ).resolves.toBeDefined();
    });

    it.each(['join', 'before_match', 'preparation', 'done'])(
      'rejects score entry while %s',
      async (status) => {
        eventModel.findById.mockResolvedValue(atStatus(status));
        fixtureFound();
        await expect(
          service.setMatchScore(EVENT_ID, CREATOR, 1, { scoreA: 1, scoreB: 0 }),
        ).rejects.toBeInstanceOf(BadRequestException);
        // The gate must reject before any write is attempted.
        expect(matchModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it('404s on an unknown fixture number', async () => {
      eventModel.findById.mockResolvedValue(atStatus());
      matchModel.findOneAndUpdate.mockResolvedValue(null);
      await expect(
        service.setMatchScore(EVENT_ID, CREATOR, 99, { scoreA: 1, scoreB: 0 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('standings', () => {
    it('derives the table from stored fixtures', async () => {
      eventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: EVENT_ID }),
      });
      matchModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { teamA: 'Red', teamB: 'Blue', scoreA: 2, scoreB: 0 },
          { teamA: 'Red', teamB: 'Blue', scoreA: null, scoreB: null },
        ]),
      });

      const table = await service.standings(EVENT_ID);
      expect(table[0]).toMatchObject({ team: 'Red', points: 3, played: 1 });
      // Blue still appears despite losing, seeded from the fixture list.
      expect(table.map((r) => r.team).sort()).toEqual(['Blue', 'Red']);
    });

    it('404s for a missing event', async () => {
      eventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });
      await expect(service.standings(EVENT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
