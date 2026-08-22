// src/events/events.service.teams.spec.ts
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { eventsProviders } from './events.test-providers';

const EVENT_ID = '507f1f77bcf86cd799439011';
const CREATOR = '507f191e810c19729de860ea';
const P1 = '507f191e810c19729de860e1';
const P2 = '507f191e810c19729de860e2';
const P3 = '507f191e810c19729de860e3';
const P4 = '507f191e810c19729de860e4';
const STRANGER = '507f191e810c19729de860ef';

const eventDoc = (over: Record<string, unknown> = {}) => {
  const doc: any = {
    _id: new Types.ObjectId(EVENT_ID),
    createdBy: new Types.ObjectId(CREATOR),
    groupId: null,
    status: 'preparation',
    teamCount: 4,
    duration: 90,
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
  const teamModel: any = {};
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
    playerModel.updateMany = jest.fn().mockResolvedValue({});
    teamModel.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });
    // toJSON must echo a REAL ObjectId: shuffleTeams feeds these ids straight
    // back into assignTeamPlayers, which validates them.
    teamModel.insertMany = jest.fn().mockImplementation((rows: any[]) =>
      Promise.resolve(
        rows.map((row) => {
          const _id = new Types.ObjectId();
          return { ...row, _id, toJSON: () => ({ ...row, _id }) };
        }),
      ),
    );
    teamModel.findOne = jest.fn();
    teamModel.find = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
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
          teamModel,
          notifications,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  const submit = (teams: { name: string; playerIds: string[] }[]) =>
    service.submitTeams(EVENT_ID, CREATOR, { teams } as any);

  describe('generateTeams gating', () => {
    const generate = (over: Record<string, unknown> = {}) =>
      service.generateTeams(EVENT_ID, CREATOR, {
        teamsCount: 2,
        duration: 30,
        numberOfPlayers: 5,
        ...over,
      } as any);

    it.each(['join', 'before_match', 'playing', 'after_match', 'done'])(
      'rejects generation while %s',
      async (status) => {
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(generate()).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('accepts generation during preparation', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(generate()).resolves.toBeDefined();
    });

    it('refuses a match duration that does not fit the event', async () => {
      // 60-minute event, 10 reserved as buffer -> a 90-minute match cannot fit.
      eventModel.findById.mockResolvedValue(eventDoc({ duration: 60 }));
      await expect(generate({ duration: 90 })).rejects.toThrow(
        /does not fit/,
      );
    });

    it('refuses a stranger', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(
        service.generateTeams(EVENT_ID, STRANGER, {
          teamsCount: 2,
          duration: 30,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('generateTeams — teams and schedule', () => {
    const generate = (over: Record<string, unknown> = {}) =>
      service.generateTeams(EVENT_ID, CREATOR, {
        teamsCount: 3,
        duration: 30,
        numberOfPlayers: 5,
        ...over,
      } as any);

    it('creates the requested number of EMPTY teams', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const res = await generate();

      const inserted = teamModel.insertMany.mock.calls[0][0];
      expect(inserted).toHaveLength(3);
      // Players are assigned in a SEPARATE step — generation must not fill them.
      expect(inserted.every((t: any) => t.players.length === 0)).toBe(true);
      expect(inserted.every((t: any) => t.status === 'pending')).toBe(true);
      expect(res.teams).toHaveLength(3);
    });

    it('names teams from the colour vocabulary in order', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate();

      const names = teamModel.insertMany.mock.calls[0][0].map((t: any) => t.name);
      expect(names).toEqual(['Red', 'Yellow', 'Blue']);
    });

    it('stores the match duration on each team', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate({ duration: 25 });

      const inserted = teamModel.insertMany.mock.calls[0][0];
      expect(inserted.every((t: any) => t.duration === 25)).toBe(true);
    });

    it('stores numberOfPlayers on each team', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate({ numberOfPlayers: 7 });

      const inserted = teamModel.insertMany.mock.calls[0][0];
      expect(inserted.every((t: any) => t.numberOfPlayers === 7)).toBe(true);
    });

    it('does NOT validate numberOfPlayers against the joined roster', async () => {
      // It is the organizer's target, not a constraint — 4 joined players and a
      // target of 11 is a legitimate mid-setup state, not an error.
      eventModel.findById.mockResolvedValue(eventDoc());

      await expect(generate({ numberOfPlayers: 11 })).resolves.toBeDefined();
    });

    // The spec's worked examples.
    it.each([
      [90, 30, 2],
      [100, 30, 3],
      [60, 30, 1],
    ])(
      'event %i min with %i-min matches -> %i matches',
      async (eventDuration, matchDuration, expected) => {
        eventModel.findById.mockResolvedValue(
          eventDoc({ duration: eventDuration }),
        );
        const res = await generate({ duration: matchDuration });

        expect(res.matchCount).toBe(expected);
        expect(matchModel.insertMany.mock.calls[0][0]).toHaveLength(expected);
      },
    );

    it('reports how the schedule was derived', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ duration: 100 }));
      const res = await generate({ duration: 30 });

      expect(res.schedule).toEqual({
        eventDuration: 100,
        bufferMinutes: 10,
        matchDuration: 30,
        scheduledMinutes: 90,
      });
    });

    it('never schedules more minutes than the event holds', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ duration: 90 }));
      const res = await generate({ duration: 30 });

      expect(res.schedule.scheduledMinutes).toBeLessThanOrEqual(90 - 10);
    });

    it('replaces previous teams and fixtures on re-generation', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate();

      // Stale teams would otherwise keep players on teams with no fixtures.
      expect(teamModel.deleteMany).toHaveBeenCalled();
      expect(matchModel.deleteMany).toHaveBeenCalled();
      expect(playerModel.updateMany).toHaveBeenCalledWith(
        expect.anything(),
        { $set: { team: null } },
      );
    });

    it('upserts one chat room per team', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate();

      expect(teamChatModel.updateOne).toHaveBeenCalledTimes(3);
    });

    it('notifies nobody — no players are assigned yet', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate();

      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('assignTeamPlayers', () => {
    const TEAM_ID = '507f1f77bcf86cd799439099';

    /** A saveable team doc double. */
    const teamDoc = (over: Record<string, unknown> = {}) => {
      const doc: any = {
        _id: new Types.ObjectId(TEAM_ID),
        eventId: new Types.ObjectId(EVENT_ID),
        name: 'Red',
        players: [],
        duration: 30,
        numberOfPlayers: 5,
        status: 'pending',
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
        toJSON: jest.fn().mockImplementation(function (this: any) {
          const { save, toJSON, ...rest } = this;
          return rest;
        }),
        ...over,
      };
      return doc;
    };

    beforeEach(() => {
      teamModel.findOne = jest.fn().mockResolvedValue(teamDoc());
      teamModel.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
    });

    const assign = (playerIds: string[], userId = CREATOR) =>
      service.assignTeamPlayers(EVENT_ID, TEAM_ID, userId, {
        playerIds,
      } as any);

    it('stores the roster and marks the team ready', async () => {
      const doc = teamDoc();
      teamModel.findOne.mockResolvedValue(doc);
      eventModel.findById.mockResolvedValue(eventDoc());

      await assign([P1, P2]);

      expect(doc.players.map(String)).toEqual([P1, P2]);
      expect(doc.status).toBe('ready');
      expect(doc.save).toHaveBeenCalled();
    });

    it('mirrors the assignment onto EventPlayer.team', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await assign([P1]);

      // Player-facing reads use EventPlayer.team, so it must stay in step.
      expect(playerModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: { $in: expect.anything() } }),
        { $set: { team: 'Red' } },
      );
    });

    it('notifies each assigned player', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await assign([P1, P2]);

      expect(notifications.create).toHaveBeenCalledTimes(2);
    });

    it('an empty roster clears the team back to pending', async () => {
      const doc = teamDoc({ players: [new Types.ObjectId(P1)], status: 'ready' });
      teamModel.findOne.mockResolvedValue(doc);
      eventModel.findById.mockResolvedValue(eventDoc());

      await assign([]);

      expect(doc.players).toEqual([]);
      expect(doc.status).toBe('pending');
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('rejects a player who never joined the event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const stranger = '507f191e810c19729de860ff';

      await expect(assign([stranger])).rejects.toThrow(/not a joined player/);
    });

    it('rejects a roster larger than numberOfPlayers', async () => {
      // The squad size set at generation time is a hard limit: you cannot
      // assign more players than the organizer planned for.
      teamModel.findOne.mockResolvedValue(teamDoc({ numberOfPlayers: 1 }));
      eventModel.findById.mockResolvedValue(eventDoc());

      await expect(assign([P1, P2])).rejects.toThrow(/holds at most 1/);
    });

    it('accepts a roster exactly at numberOfPlayers', async () => {
      teamModel.findOne.mockResolvedValue(teamDoc({ numberOfPlayers: 2 }));
      eventModel.findById.mockResolvedValue(eventDoc());

      await expect(assign([P1, P2])).resolves.toBeDefined();
    });

    it('accepts an UNDER-filled roster — built up incrementally', async () => {
      teamModel.findOne.mockResolvedValue(teamDoc({ numberOfPlayers: 5 }));
      eventModel.findById.mockResolvedValue(eventDoc());

      await expect(assign([P1])).resolves.toBeDefined();
    });

    it('rejects the same player listed twice in one team', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(assign([P1, P1])).rejects.toThrow(/listed twice/);
    });

    it('rejects a player already in another team, naming that team', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      teamModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'other', name: 'Blue', players: [new Types.ObjectId(P1)] },
        ]),
      });

      // Two teams claiming one player would corrupt standings and stats.
      await expect(assign([P1])).rejects.toThrow(/already in Blue/);
    });

    it.each(['join', 'before_match', 'playing', 'after_match', 'done'])(
      'rejects assignment while %s',
      async (status) => {
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(assign([P1])).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('404s an unknown team id', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      teamModel.findOne.mockResolvedValue(null);

      await expect(assign([P1])).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a malformed team id without casting it', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(
        service.assignTeamPlayers(EVENT_ID, 'not-an-id', CREATOR, {
          playerIds: [],
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('renames the team when a name is supplied', async () => {
      const doc = teamDoc();
      teamModel.findOne.mockResolvedValue(doc);
      eventModel.findById.mockResolvedValue(eventDoc());

      await service.assignTeamPlayers(EVENT_ID, TEAM_ID, CREATOR, {
        playerIds: [P1],
        name: 'Crimson',
      } as any);

      expect(doc.name).toBe('Crimson');
    });
  });

  describe('shuffleTeams — the server-side fallback (§4.3.3)', () => {
    beforeEach(() => {
      teamModel.findOne = jest.fn().mockImplementation(() =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          name: 'Red',
          players: [],
          save: jest.fn().mockResolvedValue(undefined),
          toJSON() {
            return { name: this.name, players: this.players };
          },
        }),
      );
      teamModel.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
    });

    it('generates teams and assigns every joined player', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const res = await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(teamModel.insertMany).toHaveBeenCalled();
      // One assign call per generated team.
      expect(res.teams).toHaveLength(
        teamModel.insertMany.mock.calls[0][0].length,
      );
    });

    it('caps team count at the number of players so no team is empty', async () => {
      playerModel.find.mockReturnValue(joinedPlayers([P1, P2]));
      eventModel.findById.mockResolvedValue(eventDoc({ teamCount: 4 }));

      await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(teamModel.insertMany.mock.calls[0][0]).toHaveLength(2);
    });

    it('refuses to shuffle fewer than two players', async () => {
      playerModel.find.mockReturnValue(joinedPlayers([P1]));
      eventModel.findById.mockResolvedValue(eventDoc());

      await expect(
        service.shuffleTeams(EVENT_ID, CREATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is gated to preparation', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'playing' }));
      await expect(
        service.shuffleTeams(EVENT_ID, CREATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('addMatch — manual fixture', () => {
    const teamRows = (names: string[]) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(names.map((name) => ({ name }))),
    });
    /** matchModel.findOne(...).sort(...).select(...).lean() -> highest match */
    const highest = (matchNumber: number | null) => ({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(matchNumber === null ? null : { matchNumber }),
    });

    beforeEach(() => {
      eventModel.findById.mockResolvedValue(eventDoc());
      teamModel.find = jest.fn().mockReturnValue(teamRows(['Red', 'Yellow', 'Blue']));
      matchModel.findOne = jest.fn().mockReturnValue(highest(2));
      matchModel.create = jest
        .fn()
        .mockImplementation((row: any) =>
          Promise.resolve({ ...row, _id: 'new', toJSON: () => ({ ...row, _id: 'new' }) }),
        );
    });

    const add = (teamA: string, teamB: string, userId = CREATOR) =>
      service.addMatch(EVENT_ID, userId, { teamA, teamB } as any);

    it('appends after the highest existing matchNumber', async () => {
      const res: any = await add('Blue', 'Red');
      expect(res.matchNumber).toBe(3);
    });

    it('starts at 1 when the event has no fixtures yet', async () => {
      matchModel.findOne.mockReturnValue(highest(null));
      const res: any = await add('Blue', 'Red');
      expect(res.matchNumber).toBe(1);
    });

    it('creates the fixture unplayed', async () => {
      const res: any = await add('Blue', 'Red');
      // null, not 0 — 0 is a real goalless scoreline.
      expect(res.scoreA).toBeNull();
      expect(res.scoreB).toBeNull();
      expect(res.playedAt).toBeNull();
    });

    it('rejects a team name that is not on the event', async () => {
      await expect(add('Green', 'Red')).rejects.toThrow(/not a team on this event/);
    });

    it('rejects a team playing itself', async () => {
      await expect(add('Red', 'Red')).rejects.toThrow(/cannot play itself/);
    });

    it('rejects when the event has no teams yet', async () => {
      teamModel.find.mockReturnValue(teamRows([]));
      await expect(add('Red', 'Blue')).rejects.toThrow(/no teams yet/);
    });

    it('normalises casing to the stored team name', async () => {
      // Fixtures key on the name, so 'blue' must not create a phantom team.
      const res: any = await add('blue', 'rED');
      expect(res.teamA).toBe('Blue');
      expect(res.teamB).toBe('Red');
    });

    it('refuses a non-organizer', async () => {
      await expect(add('Blue', 'Red', STRANGER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(matchModel.create).not.toHaveBeenCalled();
    });

    it.each(['join', 'preparation', 'playing', 'after_match', 'done'])(
      'is allowed in %s — no lifecycle gate by decision',
      async (status) => {
        // Deliberately ungated: this is an escape hatch for a schedule the
        // generator could not express, and an organizer may need it late.
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(add('Blue', 'Red')).resolves.toBeDefined();
      },
    );
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
