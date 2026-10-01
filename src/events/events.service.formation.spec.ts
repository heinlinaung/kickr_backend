// src/events/events.service.formation.spec.ts
//
// Team formation: permissions (organizer OR this team's captain), the
// archived gate, membership (players + guests), and the resolved read.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { EventsService } from './events.service';
import { eventsProviders } from './events.test-providers';

const EVENT_ID = '507f191e810c19729de86101';
const TEAM_ID = '507f191e810c19729de86102';
const GROUP_ID = '507f191e810c19729de86103';
const CREATOR = '507f191e810c19729de86104';
const CAPTAIN = '507f191e810c19729de86105';
const STRANGER = '507f191e810c19729de86106';
const P1 = '507f191e810c19729de86111';
const P2 = '507f191e810c19729de86112';
const P3 = '507f191e810c19729de86113';
const GUEST_ROW = '507f191e810c19729de86120';

describe('EventsService — team formation', () => {
  let service: EventsService;

  const eventModel: any = {};
  const teamModel: any = {};
  const memberModel: any = {};
  const playerModel: any = {};
  const userModel: any = {};
  let teamDoc: any;

  // A 5-a-side squad: the captain keeps goal, three registered players and
  // one guest fill the outfield.
  const squadDto = () => ({
    name: 'My 2-2',
    playerCount: 5,
    formation: '2-2',
    players: {
      goalkeeper: CAPTAIN,
      defenders: [P1, P2],
      midfielders: [],
      forwards: [P3, GUEST_ROW],
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    eventModel.findById = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(EVENT_ID),
      status: 'join',
      groupId: new Types.ObjectId(GROUP_ID),
      createdBy: new Types.ObjectId(CREATOR),
    });

    teamDoc = {
      _id: new Types.ObjectId(TEAM_ID),
      eventId: new Types.ObjectId(EVENT_ID),
      players: [CAPTAIN, P1, P2, P3].map((id) => new Types.ObjectId(id)),
      guests: [new Types.ObjectId(GUEST_ROW)],
      playerRoles: [
        { userId: new Types.ObjectId(CAPTAIN), role: 'captain' },
      ],
      formation: null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    // Awaiting a non-thenable yields the object itself, so one mock serves
    // both the document path (set) and the .lean() path (get).
    teamDoc.lean = jest.fn(() => Promise.resolve({ ...teamDoc }));
    teamModel.findOne = jest.fn().mockReturnValue(teamDoc);

    // Default: the caller holds no group role — only the creator or the
    // team captain pass.
    memberModel.findOne = jest.fn().mockResolvedValue(null);

    playerModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest
        .fn()
        .mockResolvedValue([
          { _id: new Types.ObjectId(GUEST_ROW), name: 'Guest Joe' },
        ]),
    });
    userModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(
        [
          [CAPTAIN, 'Cap'],
          [P1, 'One'],
          [P2, 'Two'],
          [P3, 'Three'],
        ].map(([id, name]) => ({ _id: new Types.ObjectId(id), name })),
      ),
    });

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          teamModel,
          memberModel,
          playerModel,
          userModel,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  const set = (userId = CAPTAIN, dto = squadDto()) =>
    service.setTeamFormation(EVENT_ID, userId, TEAM_ID, dto as any);

  describe('guards', () => {
    it('400s a malformed team id', async () => {
      await expect(
        service.setTeamFormation(EVENT_ID, CAPTAIN, 'nope', squadDto() as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s a missing event', async () => {
      eventModel.findById.mockResolvedValue(null);
      await expect(set()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks an archived event', async () => {
      eventModel.findById.mockResolvedValue({
        _id: new Types.ObjectId(EVENT_ID),
        status: 'done',
        groupId: null,
        createdBy: new Types.ObjectId(CREATOR),
      });
      await expect(set(CREATOR)).rejects.toThrow(/archived/);
    });

    it('404s a team that belongs to another event', async () => {
      teamModel.findOne.mockReturnValue(null);
      await expect(set()).rejects.toThrow('Team not found for this event');
    });
  });

  describe('permission — organizer OR this team\'s captain', () => {
    it("lets the team's captain set the line-up without any group role", async () => {
      await expect(set(CAPTAIN)).resolves.toBeDefined();
      // The organizer check never ran — captaincy alone authorized.
      expect(memberModel.findOne).not.toHaveBeenCalled();
    });

    it('lets the event creator set it', async () => {
      await expect(set(CREATOR)).resolves.toBeDefined();
    });

    it('lets a group admin set it', async () => {
      memberModel.findOne.mockResolvedValue({ role: 'admin' });
      await expect(set(STRANGER)).resolves.toBeDefined();
    });

    it('403s a plain player, naming who may', async () => {
      await expect(set(P1)).rejects.toThrow(/team's captain/);
      await expect(set(P1)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('layout and membership validation', () => {
    it('rejects a layout whose arithmetic is broken', async () => {
      const dto = squadDto();
      dto.playerCount = 6;
      await expect(set(CAPTAIN, dto)).rejects.toThrow(/playerCount is 6/);
      expect(teamDoc.save).not.toHaveBeenCalled();
    });

    it('rejects someone not on the team, naming the id', async () => {
      const dto = squadDto();
      dto.players.forwards = [P3, STRANGER];
      await expect(set(CAPTAIN, dto)).rejects.toThrow(
        new RegExp(`'${STRANGER}' is not assigned to this team`),
      );
    });

    it('accepts a GUEST roster-row id in a slot', async () => {
      // squadDto already places GUEST_ROW at forward — the membership set is
      // players ∪ guests.
      await expect(set(CAPTAIN)).resolves.toBeDefined();
    });
  });

  describe('persistence and the resolved read', () => {
    it('stores the submitted order and stamps who set it', async () => {
      await set(CAPTAIN);

      expect(teamDoc.save).toHaveBeenCalled();
      expect(teamDoc.formation.formation).toBe('2-2');
      expect(teamDoc.formation.playerCount).toBe(5);
      expect(teamDoc.formation.defenders.map(String)).toEqual([P1, P2]);
      expect(teamDoc.formation.forwards.map(String)).toEqual([P3, GUEST_ROW]);
      expect(teamDoc.formation.setBy.toString()).toBe(CAPTAIN);
      expect(teamDoc.formation.setAt).toBeInstanceOf(Date);
    });

    it('returns the resolved formation: names, order, and isGuest flags', async () => {
      const res: any = await set(CAPTAIN);

      expect(res.teamId).toBe(TEAM_ID);
      expect(res.formation).toBe('2-2');
      expect(res.players.goalkeeper).toEqual({
        id: CAPTAIN,
        name: 'Cap',
        isGuest: false,
      });
      expect(res.players.defenders.map((p: any) => p.name)).toEqual([
        'One',
        'Two',
      ]);
      // The guest resolves from the roster row, flagged as a guest.
      expect(res.players.forwards[1]).toEqual({
        id: GUEST_ROW,
        name: 'Guest Joe',
        isGuest: true,
      });
    });

    it('404s the read until a formation is set', async () => {
      await expect(
        service.getTeamFormation(EVENT_ID, TEAM_ID),
      ).rejects.toThrow('No formation has been set for this team');
    });

    it('a since-removed member resolves to a null name, not a shifted line-up', async () => {
      await set(CAPTAIN);
      userModel.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        // The user lookup no longer finds P1 (account deleted).
        lean: jest.fn().mockResolvedValue([]),
      });
      playerModel.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      const res: any = await service.getTeamFormation(EVENT_ID, TEAM_ID);

      expect(res.players.defenders).toHaveLength(2);
      expect(res.players.defenders[0]).toEqual({
        id: P1,
        name: null,
        isGuest: false,
      });
    });
  });
});
