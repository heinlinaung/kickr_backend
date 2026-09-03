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

/** playerModel.find(...).select(...).sort(...).lean() -> guest roster rows */
const guestRows = (ids: string[]) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  lean: jest
    .fn()
    .mockResolvedValue(ids.map((id) => ({ _id: new Types.ObjectId(id) }))),
});

/** Overrides only the REGISTERED half of the roster mock; guests stay empty. */
const onlyPlayers = (playerModel: any, ids: string[]) =>
  playerModel.find.mockImplementation((q: any = {}) =>
    q.type === 'guest' ? guestRows([]) : joinedPlayers(ids),
  );

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
    // Two roster queries now: registered players, then approved guests. The
    // double branches on the query so the guest lookup does not receive player
    // documents; individual tests override it to supply guests.
    playerModel.find = jest.fn().mockImplementation((q: any = {}) =>
      q.type === 'guest'
        ? guestRows([])
        : joinedPlayers([P1, P2, P3, P4]),
    );
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
    // shuffleTeams reads the already-scheduled match duration rather than
    // inventing one; no schedule yet by default.
    matchModel.findOne = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });
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
      // `.select` included because the real chain is
      // .find().select().sort().lean() — a double missing it makes the team
      // name lookup throw instead of returning names.
      select: jest.fn().mockReturnThis(),
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
      // Response is a plain success message now — the client re-reads
      // GET /events/:id/teams for ids.
      expect(res).toEqual({ message: expect.any(String) });
    });

    describe('event.teamCount', () => {
      it('is updated to the teamsCount that was generated', async () => {
        const doc = eventDoc({ teamCount: 4 });
        eventModel.findById.mockResolvedValue(doc);

        await generate({ teamsCount: 3 });

        expect(doc.teamCount).toBe(3);
        expect(doc.save).toHaveBeenCalled();
      });

      it('keeps the event and the teams that exist in agreement', async () => {
        // The bug this fixes: generating 3 teams left event.teamCount at 4, so
        // a later POST /shuffle silently rebuilt as 4.
        const doc = eventDoc({ teamCount: 4 });
        eventModel.findById.mockResolvedValue(doc);

        await generate({ teamsCount: 2 });

        expect(doc.teamCount).toBe(
          teamModel.insertMany.mock.calls[0][0].length,
        );
      });

      it('does not persist when the request is rejected', async () => {
        // A 400 must leave the event exactly as it was.
        const doc = eventDoc({ teamCount: 4, duration: 60 });
        eventModel.findById.mockResolvedValue(doc);

        await expect(generate({ duration: 90 })).rejects.toThrow(/does not fit/);

        expect(doc.teamCount).toBe(4);
        expect(doc.save).not.toHaveBeenCalled();
      });

      it('does not persist when the colours are invalid', async () => {
        const doc = eventDoc({ teamCount: 4 });
        eventModel.findById.mockResolvedValue(doc);

        await expect(
          generate({ teamsCount: 3, colors: ['red', 'blue'] }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(doc.teamCount).toBe(4);
        expect(doc.save).not.toHaveBeenCalled();
      });
    });

    it('returns ONLY a success message', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const res: any = await generate();

      expect(Object.keys(res)).toEqual(['message']);
      expect(res.teams).toBeUndefined();
      expect(res.matches).toBeUndefined();
      expect(res.matchCount).toBeUndefined();
      expect(res.schedule).toBeUndefined();
    });

    it('falls back to the colour vocabulary when no colours are sent', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate();

      const names = teamModel.insertMany.mock.calls[0][0].map((t: any) => t.name);
      expect(names).toEqual(['Red', 'Yellow', 'Blue']);
    });

    describe('caller-supplied colours', () => {
      it('names the teams from `colors`, in order', async () => {
        eventModel.findById.mockResolvedValue(eventDoc());
        await generate({ colors: ['red', 'blue', 'white'] });

        const names = teamModel.insertMany.mock.calls[0][0].map(
          (t: any) => t.name,
        );
        expect(names).toEqual(['red', 'blue', 'white']);
      });

      it('does not validate spelling — any label is accepted', async () => {
        eventModel.findById.mockResolvedValue(eventDoc());
        await generate({ colors: ['puce', 'not-a-colour', 'zzz'] });

        const names = teamModel.insertMany.mock.calls[0][0].map(
          (t: any) => t.name,
        );
        expect(names).toEqual(['puce', 'not-a-colour', 'zzz']);
      });

      it('rejects a colour count that disagrees with teamsCount', async () => {
        eventModel.findById.mockResolvedValue(eventDoc());
        await expect(
          generate({ teamsCount: 3, colors: ['red', 'blue'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          generate({ teamsCount: 3, colors: ['a', 'b', 'c', 'd'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('rejects duplicate colours', async () => {
        // Team names key the fixtures and the chat rooms, so two teams sharing
        // a name makes both ambiguous. Case-insensitive: Red and red collide.
        eventModel.findById.mockResolvedValue(eventDoc());
        await expect(
          generate({ colors: ['red', 'blue', 'red'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          generate({ colors: ['Red', 'blue', 'red'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('builds the fixtures from the supplied names', async () => {
        eventModel.findById.mockResolvedValue(eventDoc());
        await generate({ teamsCount: 2, colors: ['pink', 'green'] });

        const fixtures = matchModel.insertMany.mock.calls[0][0];
        const named = fixtures.flatMap((f: any) => [f.teamA, f.teamB]);
        expect(new Set(named)).toEqual(new Set(['pink', 'green']));
      });
    });

    it('stores the match duration on each FIXTURE, not on the team', async () => {
      // It describes a match, not a squad. Teams all held the same value, so
      // per-team storage was redundant and could drift.
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate({ duration: 25 });

      const fixtures = matchModel.insertMany.mock.calls[0][0];
      expect(fixtures.every((f: any) => f.duration === 25)).toBe(true);

      const teams = teamModel.insertMany.mock.calls[0][0];
      expect(teams.every((t: any) => t.duration === undefined)).toBe(true);
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

    // Fix: the fixture list used to be TRUNCATED to whatever fitted the
    // booked slot, which is why /events/:id/matches showed only 2-3 matches
    // for 3 teams. The full double round-robin is generated now.
    it.each([
      [2, 2],
      [3, 6],
      [4, 12],
    ])(
      '%i teams -> %i matches (full double round-robin)',
      async (teamsCount, expected) => {
        eventModel.findById.mockResolvedValue(eventDoc());
        await generate({ teamsCount });

        expect(matchModel.insertMany.mock.calls[0][0]).toHaveLength(expected);
      },
    );

    // The reported case: a 2-hour event of 10-minute matches has room for 11
    // slots, and three teams round-robin to only 6 — leaving an hour of the
    // booked pitch unscheduled.
    it.each([
      [120, 10, 11],
      [90, 10, 8],
      [240, 10, 23],
      // Below one round-robin the schedule is NOT trimmed: 40 minutes has room
      // for 3, but dropping half the pairings is the truncation bug.
      [40, 10, 6],
      [60, 30, 6],
    ])(
      '%i-min event with %i-min matches -> %i fixtures (3 teams)',
      async (eventDuration, matchDuration, expected) => {
        eventModel.findById.mockResolvedValue(
          eventDoc({ duration: eventDuration }),
        );
        await generate({ teamsCount: 3, duration: matchDuration });

        expect(matchModel.insertMany.mock.calls[0][0]).toHaveLength(expected);
      },
    );

    it('repeats the round-robin to fill, rather than inventing pairings', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ duration: 120 }));
      await generate({ teamsCount: 3, duration: 10, colors: ['a', 'b', 'c'] });

      const fixtures = matchModel.insertMany.mock.calls[0][0];
      expect(fixtures).toHaveLength(11);
      // Slot 7 repeats slot 1; matchNumbers stay unique across the schedule.
      expect(fixtures[6].teamA).toBe(fixtures[0].teamA);
      expect(fixtures[6].teamB).toBe(fixtures[0].teamB);
      expect(fixtures.map((f: any) => f.matchNumber)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
    });

    it('numbers the fixtures contiguously from 1', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate({ teamsCount: 3 });

      const numbers = matchModel.insertMany.mock.calls[0][0].map(
        (f: any) => f.matchNumber,
      );
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('every pair meets twice, home and away', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await generate({ teamsCount: 3, colors: ['a', 'b', 'c'] });

      const pairs = matchModel.insertMany.mock.calls[0][0].map(
        (f: any) => `${f.teamA}v${f.teamB}`,
      );
      // 3 pairs x 2 legs, and each ordered pairing appears exactly once.
      expect(pairs).toHaveLength(6);
      expect(new Set(pairs).size).toBe(6);
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

  describe('guests in teams', () => {
    const GUEST = '507f1f77bcf86cd7994390f1';
    const GUEST2 = '507f1f77bcf86cd7994390f2';

    /** Roster mock with both halves populated. */
    const withGuests = (players: string[], guests: string[]) =>
      playerModel.find.mockImplementation((q: any = {}) =>
        q.type === 'guest' ? guestRows(guests) : joinedPlayers(players),
      );

    const teamDoc = (over: Record<string, unknown> = {}) => {
      const doc: any = {
        _id: new Types.ObjectId(),
        eventId: new Types.ObjectId(EVENT_ID),
        name: 'Red',
        players: [],
        guests: [],
        playerRoles: [],
        numberOfPlayers: 5,
        status: 'pending',
        save: jest.fn().mockResolvedValue(undefined),
        toJSON() {
          return { name: this.name };
        },
        ...over,
      };
      return doc;
    };

    describe('assignTeamPlayers', () => {
      it('persists guests by their roster-row id', async () => {
        eventModel.findById.mockResolvedValue(eventDoc());
        withGuests([P1], [GUEST]);
        const team = teamDoc();
        teamModel.findOne.mockResolvedValue(team);

        await service.assignTeamPlayers(
          EVENT_ID,
          String(team._id),
          CREATOR,
          { playerIds: [P1], guestIds: [GUEST] },
        );

        expect(team.guests.map(String)).toEqual([GUEST]);
      });

      it('stamps EventPlayer.team for the guest, keyed on _id', async () => {
        // A guest has no userId, so the userId-keyed update can never reach
        // them. Without this their row stays team: null while they sit in
        // team.guests — two sources disagreeing.
        eventModel.findById.mockResolvedValue(eventDoc());
        withGuests([P1], [GUEST]);
        const team = teamDoc({ name: 'Blue' });
        teamModel.findOne.mockResolvedValue(team);

        await service.assignTeamPlayers(
          EVENT_ID,
          String(team._id),
          CREATOR,
          { playerIds: [], guestIds: [GUEST] },
        );

        const byId = playerModel.updateMany.mock.calls.find(
          ([filter]: any[]) => filter._id?.$in,
        );
        expect(byId).toBeDefined();
        expect(String(byId[0]._id.$in[0])).toBe(GUEST);
        expect(byId[1]).toEqual({ $set: { team: 'Blue' } });
      });

      it('refuses a guest who is not approved on this event', async () => {
        eventModel.findById.mockResolvedValue(eventDoc());
        withGuests([P1], []);
        teamModel.findOne.mockResolvedValue(teamDoc());

        await expect(
          service.assignTeamPlayers(EVENT_ID, String(new Types.ObjectId()), CREATOR, {
            playerIds: [],
            guestIds: [GUEST],
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('counts guests toward the squad limit', async () => {
        // 4 players + 2 guests against a limit of 5 must fail: checking only
        // registered players would let a team quietly field 6.
        eventModel.findById.mockResolvedValue(eventDoc());
        withGuests([P1, P2, P3, P4], [GUEST, GUEST2]);
        teamModel.findOne.mockResolvedValue(teamDoc({ numberOfPlayers: 5 }));

        await expect(
          service.assignTeamPlayers(EVENT_ID, String(new Types.ObjectId()), CREATOR, {
            playerIds: [P1, P2, P3, P4],
            guestIds: [GUEST, GUEST2],
          }),
        ).rejects.toThrow(/holds at most 5/);
      });

      it('refuses a guest already in another team', async () => {
        eventModel.findById.mockResolvedValue(eventDoc());
        withGuests([P1], [GUEST]);
        teamModel.findOne.mockResolvedValue(teamDoc());
        teamModel.find.mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { name: 'Yellow', players: [], guests: [new Types.ObjectId(GUEST)] },
          ]),
        });

        await expect(
          service.assignTeamPlayers(EVENT_ID, String(new Types.ObjectId()), CREATOR, {
            playerIds: [],
            guestIds: [GUEST],
          }),
        ).rejects.toThrow(/already in Yellow/);
      });

      it('clears guests when guestIds is omitted', async () => {
        // Replace-outright, like playerIds — a stale client must not silently
        // preserve a guest it did not mean to keep.
        eventModel.findById.mockResolvedValue(eventDoc());
        withGuests([P1], [GUEST]);
        const team = teamDoc({ guests: [new Types.ObjectId(GUEST)] });
        teamModel.findOne.mockResolvedValue(team);

        await service.assignTeamPlayers(
          EVENT_ID,
          String(team._id),
          CREATOR,
          { playerIds: [P1] },
        );

        expect(team.guests).toEqual([]);
      });

      it('a guest-only team still counts as ready', async () => {
        eventModel.findById.mockResolvedValue(eventDoc());
        withGuests([], [GUEST]);
        const team = teamDoc();
        teamModel.findOne.mockResolvedValue(team);

        await service.assignTeamPlayers(
          EVENT_ID,
          String(team._id),
          CREATOR,
          { playerIds: [], guestIds: [GUEST] },
        );

        expect(team.status).toBe('ready');
      });
    });

    describe('shuffleTeams', () => {
      beforeEach(() => {
        teamModel.findOne = jest.fn().mockImplementation(() => teamDoc());
        teamModel.find = jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([]),
        });
      });

      it('deals guests across the teams too', async () => {
        eventModel.findById.mockResolvedValue(eventDoc({ teamCount: 2 }));
        withGuests([P1, P2], [GUEST, GUEST2]);

        await service.shuffleTeams(EVENT_ID, CREATOR);

        // Both guest ids land somewhere across the assign calls.
        const dealt = playerModel.updateMany.mock.calls
          .filter(([f]: any[]) => f._id?.$in)
          .flatMap(([f]: any[]) => f._id.$in.map(String));
        expect(dealt.sort()).toEqual([GUEST, GUEST2].sort());
      });

      it('counts guests toward the minimum to shuffle', async () => {
        // One registered player plus two approved guests is playable.
        eventModel.findById.mockResolvedValue(eventDoc({ teamCount: 2 }));
        withGuests([P1], [GUEST, GUEST2]);

        await expect(
          service.shuffleTeams(EVENT_ID, CREATOR),
        ).resolves.toBeDefined();
      });

      it('sizes numberOfPlayers from players AND guests', async () => {
        // 2 + 2 over 2 teams is 2 each. Counting only registered players would
        // set a limit of 1 that the guests then breach.
        eventModel.findById.mockResolvedValue(eventDoc({ teamCount: 2 }));
        withGuests([P1, P2], [GUEST, GUEST2]);

        await service.shuffleTeams(EVENT_ID, CREATOR);

        const inserted = teamModel.insertMany.mock.calls[0][0];
        expect(inserted.every((t: any) => t.numberOfPlayers === 2)).toBe(true);
      });
    });
  });

  describe('GET /events/:id/matches carries the duration', () => {
    it('returns each fixture whole, duration included', async () => {
      // The fixture list must be able to report how long each game is without
      // joining back through a team — that is why duration moved onto the
      // match. listMatches applies no projection, so this is a guard against
      // one being added later and silently dropping it.
      eventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(EVENT_ID) }),
      });
      matchModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { matchNumber: 1, teamA: 'Red', teamB: 'Yellow', duration: 15 },
        ]),
      });

      const rows: any = await service.listMatches(EVENT_ID);

      expect(rows[0].duration).toBe(15);
    });
  });

  describe('the roster query must tolerate legacy rows', () => {
    it('excludes guests rather than requiring type: registered', async () => {
      // REGRESSION. `type` was added on 2026-08-31 with a default, and Mongoose
      // defaults apply on WRITE, not on read - so every roster row created
      // before that date has NO `type` field at all. A positive
      // { type: 'registered' } matched none of them, so shuffle saw an empty
      // roster on every pre-existing event and answered
      // "At least 2 joined players are needed to shuffle teams".
      //
      // Phrased as an exclusion, legacy rows pass and guests still do not.
      eventModel.findById.mockResolvedValue(eventDoc());
      onlyPlayers(playerModel, [P1, P2, P3, P4]);

      // Only the roster QUERY is under test here; the shuffle goes on to
      // assign teams, which this block does not mock. Whether that later half
      // succeeds is irrelevant to the filter shape.
      await service.shuffleTeams(EVENT_ID, CREATOR).catch(() => undefined);

      const q = playerModel.find.mock.calls[0][0];
      expect(q.type).toEqual({ $ne: 'guest' });
      // Same reasoning already applied to approval.
      expect(q.approval).toEqual({ $nin: ['pending', 'rejected'] });
    });
  });

  describe('shuffleTeams — team names are preserved', () => {
    // The shuffle deletes and recreates every team row, so without an explicit
    // carry-over the organizer's names silently became Red/Yellow/Blue. Same
    // class of bug as the duration clobber.
    const namesStub = (names: string[]) => {
      teamModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest
          .fn()
          .mockResolvedValue(names.map((name) => ({ name }))),
      });
    };
    const insertedNames = () =>
      (teamModel.insertMany.mock.calls[0][0] as any[]).map((r) => r.name);

    beforeEach(() => {
      teamModel.findOne = jest.fn().mockImplementation(() =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          name: 'x',
          players: [],
          save: jest.fn().mockResolvedValue(undefined),
          toJSON() {
            return { name: this.name, players: this.players };
          },
        }),
      );
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'preparation', teamCount: 3 }),
      );
      playerModel.find = jest.fn().mockImplementation((q: any) =>
        q?.type === 'guest'
          ? { select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) }
          : {
              select: jest.fn().mockReturnThis(),
              sort: jest.fn().mockReturnThis(),
              lean: jest.fn().mockResolvedValue(
                [P1, P2, P3, P4].map((id) => ({
                  userId: new Types.ObjectId(id),
                })),
              ),
            },
      );
    });

    it('keeps custom names instead of resetting them to colours', async () => {
      namesStub(['Lions', 'Tigers', 'Bears']);

      await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(insertedNames()).toEqual(['Lions', 'Tigers', 'Bears']);
    });

    it('pads from unused colours when the team count grows', async () => {
      // 2 existing names, 3 teams wanted -> keep both, add the first colour
      // that is not already taken.
      namesStub(['Lions', 'Tigers']);

      await service.shuffleTeams(EVENT_ID, CREATOR);

      const names = insertedNames();
      expect(names.slice(0, 2)).toEqual(['Lions', 'Tigers']);
      expect(names).toHaveLength(3);
      expect(names[2]).toBe('Red');
    });

    it('never pads with a name already in use', async () => {
      // 'Red' is taken, so padding must skip it rather than duplicate it —
      // {eventId, name} is uniquely indexed, so a repeat fails the insert.
      namesStub(['Red', 'Yellow']);

      await service.shuffleTeams(EVENT_ID, CREATOR);

      const names = insertedNames();
      expect(new Set(names).size).toBe(names.length);
      expect(names[2]).toBe('Blue');
    });

    it('truncates when the team count shrinks', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'preparation', teamCount: 2 }),
      );
      namesStub(['Lions', 'Tigers', 'Bears']);

      await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(insertedNames()).toEqual(['Lions', 'Tigers']);
    });

    it('falls back to colours when no teams exist yet', async () => {
      // A shuffle before any generate: this is a genuine first-time default,
      // not a clobber.
      namesStub([]);

      await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(insertedNames()).toEqual(['Red', 'Yellow', 'Blue']);
    });

    it('reads the names BEFORE the teams are deleted', async () => {
      // Ordering is the whole fix: createTeamsAndFixtures deletes every row,
      // so a lookup after it would always find nothing.
      const order: string[] = [];
      teamModel.find = jest.fn().mockImplementation(() => {
        order.push('find');
        return {
          select: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ name: 'Lions' }]),
        };
      });
      teamModel.deleteMany = jest.fn().mockImplementation(() => {
        order.push('deleteMany');
        return Promise.resolve({ deletedCount: 1 });
      });

      await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(order.indexOf('find')).toBeLessThan(order.indexOf('deleteMany'));
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
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
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

    it('does NOT write its capped team count back to the event', async () => {
      // Shuffle's count is a roster-derived CAP, not the organizer's intent.
      // Persisting it would permanently downgrade teamCount whenever few
      // players had joined: 4 intended, 2 joined, and every later shuffle
      // would build 2 teams even once the roster filled up. Only
      // POST /teams/generate, where the organizer states a number, persists.
      onlyPlayers(playerModel, [P1, P2]);
      const doc = eventDoc({ teamCount: 4 });
      eventModel.findById.mockResolvedValue(doc);

      await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(teamModel.insertMany.mock.calls[0][0]).toHaveLength(2);
      expect(doc.teamCount).toBe(4);
    });

    it('caps team count at the number of players so no team is empty', async () => {
      onlyPlayers(playerModel, [P1, P2]);
      eventModel.findById.mockResolvedValue(eventDoc({ teamCount: 4 }));

      await service.shuffleTeams(EVENT_ID, CREATOR);

      expect(teamModel.insertMany.mock.calls[0][0]).toHaveLength(2);
    });

    it('refuses to shuffle fewer than two players', async () => {
      onlyPlayers(playerModel, [P1]);
      eventModel.findById.mockResolvedValue(eventDoc());

      await expect(
        service.shuffleTeams(EVENT_ID, CREATOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['join', 'ready_to_play', 'playing', 'after_match', 'done'])(
      'is gated to preparation — refused while %s',
      async (status) => {
        // ready_to_play matters most here: freezing the roster is that state's
        // entire purpose, so a re-shuffle must not slip through after the
        // teams have been reviewed.
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(
          service.shuffleTeams(EVENT_ID, CREATOR),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );
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

    it.each([
      'join',
      'preparation',
      'ready_to_play',
      'playing',
      'after_match',
      'done',
    ])(
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

    it.each(['join', 'preparation', 'ready_to_play', 'done'])(
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

  describe('setMatchScore — who may score', () => {
    const GROUP_ID = '507f191e810c19729de860cc';
    const REFEREE = '507f191e810c19729de860f1';

    /** A group event, so the group-role check actually runs. */
    const groupEvent = () =>
      eventDoc({ status: 'playing', groupId: new Types.ObjectId(GROUP_ID) });

    /** memberModel.findOne resolves only if `role` is in the queried $in list. */
    const asRole = (role: string) =>
      memberModel.findOne.mockImplementation((filter: any) => {
        const allowed = filter?.role?.$in ?? [];
        return Promise.resolve(
          allowed.includes(role) ? { role, status: 'approved' } : null,
        );
      });

    beforeEach(() => {
      eventModel.findById.mockResolvedValue(groupEvent());
      matchModel.findOneAndUpdate = jest.fn().mockImplementation((_f, u) => {
        const row = { matchNumber: 1, teamA: 'Red', teamB: 'Blue', ...u.$set };
        return Promise.resolve({ ...row, toJSON: () => row });
      });
    });

    const score = (userId: string) =>
      service.setMatchScore(EVENT_ID, userId, 1, { scoreA: 2, scoreB: 1 });

    it('lets a group REFEREE enter a score', async () => {
      // The role exists to officiate; scoring is the one thing it grants.
      asRole('referee');
      await expect(score(REFEREE)).resolves.toMatchObject({ scoreA: 2 });
    });

    it('still lets an owner and an admin score', async () => {
      asRole('owner');
      await expect(score(REFEREE)).resolves.toBeDefined();
      asRole('admin');
      await expect(score(REFEREE)).resolves.toBeDefined();
    });

    it('refuses a captain — officiating is not a captain concern', async () => {
      asRole('captain');
      await expect(score(REFEREE)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a plain member', async () => {
      asRole('member');
      await expect(score(REFEREE)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does NOT let a referee manage the event', async () => {
      // The whole point of the separate check: scoring only. If this starts
      // passing, referee has been added to ORGANIZER_ROLES by mistake.
      asRole('referee');
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'preparation', groupId: new Types.ObjectId(GROUP_ID) }),
      );

      await expect(
        service.generateTeams(EVENT_ID, REFEREE, {
          teamsCount: 2, duration: 30, numberOfPlayers: 3,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        service.setStatus(EVENT_ID, REFEREE, 'playing'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(service.remove(EVENT_ID, REFEREE)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('the lifecycle gate still applies to a referee', async () => {
      // Being allowed to score does not mean scoring any time.
      asRole('referee');
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'preparation', groupId: new Types.ObjectId(GROUP_ID) }),
      );
      await expect(score(REFEREE)).rejects.toBeInstanceOf(BadRequestException);
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
