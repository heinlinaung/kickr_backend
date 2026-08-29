// src/events/events.service.teamroles.spec.ts
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
const TEAM_ID = '507f1f77bcf86cd799439099';
const CREATOR = '507f191e810c19729de860ea';
const STRANGER = '507f191e810c19729de860eb';
const GROUP_ID = '507f191e810c19729de860ec';
const PLAYER = '507f191e810c19729de860ff';
const OUTSIDER = '507f191e810c19729de860fe';

describe('EventsService — team member roles', () => {
  let service: EventsService;
  const eventModel: any = {};
  const teamModel: any = {};
  const memberModel: any = {};

  const eventDoc = (over: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(EVENT_ID),
    createdBy: new Types.ObjectId(CREATOR),
    groupId: null,
    status: 'preparation',
    ...over,
  });

  const teamDoc = (over: Record<string, unknown> = {}) => {
    const doc: any = {
      _id: new Types.ObjectId(TEAM_ID),
      eventId: new Types.ObjectId(EVENT_ID),
      name: 'Red',
      players: [new Types.ObjectId(PLAYER)],
      playerRoles: [],
      save: jest.fn().mockImplementation(function (this: any) {
        return Promise.resolve(this);
      }),
      ...over,
    };
    return doc;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.findById = jest.fn().mockResolvedValue(eventDoc());
    teamModel.findOne = jest.fn().mockResolvedValue(teamDoc());
    memberModel.findOne = jest.fn().mockResolvedValue(null);

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({ eventModel, teamModel, memberModel }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  const setRole = (role: any, requester = CREATOR, target = PLAYER) =>
    service.setTeamMemberRole(EVENT_ID, TEAM_ID, target, requester, { role });

  it('records a captain on the team', async () => {
    const team = teamDoc();
    teamModel.findOne.mockResolvedValue(team);

    await setRole('captain');

    expect(team.playerRoles).toHaveLength(1);
    expect(team.playerRoles[0].userId.toString()).toBe(PLAYER);
    expect(team.playerRoles[0].role).toBe('captain');
    expect(team.save).toHaveBeenCalled();
  });

  it('stores the default role as ABSENCE, not as an entry', async () => {
    // One representation for the common case: a player cannot be both absent
    // and explicitly 'player' at the same time.
    const team = teamDoc({
      playerRoles: [{ userId: new Types.ObjectId(PLAYER), role: 'captain' }],
    });
    teamModel.findOne.mockResolvedValue(team);

    await setRole('player');

    expect(team.playerRoles).toHaveLength(0);
  });

  it('replaces rather than duplicates an existing entry', async () => {
    const team = teamDoc({
      playerRoles: [{ userId: new Types.ObjectId(PLAYER), role: 'captain' }],
    });
    teamModel.findOne.mockResolvedValue(team);

    await setRole('captain');

    expect(team.playerRoles).toHaveLength(1);
  });

  it('leaves other players untouched', async () => {
    const other = new Types.ObjectId(OUTSIDER);
    const team = teamDoc({
      players: [new Types.ObjectId(PLAYER), other],
      playerRoles: [{ userId: other, role: 'captain' }],
    });
    teamModel.findOne.mockResolvedValue(team);

    await setRole('captain');

    expect(team.playerRoles).toHaveLength(2);
  });

  it('refuses a player who is not in the squad', async () => {
    // A role on a non-member would be invisible on every read, and would
    // resurface if they were assigned later.
    await expect(setRole('captain', CREATOR, OUTSIDER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('scopes the team lookup to the event', async () => {
    // Prevents renaming a role on another event's team by guessing its id.
    await setRole('captain');

    const filter = teamModel.findOne.mock.calls[0][0];
    expect(filter.eventId.toString()).toBe(EVENT_ID);
    expect(filter._id.toString()).toBe(TEAM_ID);
  });

  it('404s a team that does not belong to this event', async () => {
    teamModel.findOne.mockResolvedValue(null);
    await expect(setRole('captain')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('admits a group captain, unlike most team routes', async () => {
    // Naming a captain is squad management, which the role exists for.
    eventModel.findById.mockResolvedValue(
      eventDoc({ groupId: new Types.ObjectId(GROUP_ID) }),
    );
    memberModel.findOne.mockResolvedValue({ role: 'captain' });

    await expect(setRole('captain', STRANGER)).resolves.toBeDefined();

    const roles = memberModel.findOne.mock.calls[0][0].role.$in;
    expect(roles).toEqual(['owner', 'admin', 'captain']);
  });

  it('403s someone with no managing role', async () => {
    eventModel.findById.mockResolvedValue(
      eventDoc({ groupId: new Types.ObjectId(GROUP_ID) }),
    );
    memberModel.findOne.mockResolvedValue(null);

    await expect(setRole('captain', STRANGER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses once the event is done', async () => {
    eventModel.findById.mockResolvedValue(eventDoc({ status: 'done' }));
    await expect(setRole('captain')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each(['join', 'preparation', 'ready_to_play', 'playing', 'after_match'])(
    'is allowed while %s',
    async (status) => {
      eventModel.findById.mockResolvedValue(eventDoc({ status }));
      await expect(setRole('captain')).resolves.toBeDefined();
    },
  );

  it('400s malformed ids', async () => {
    await expect(
      service.setTeamMemberRole(EVENT_ID, 'nope', PLAYER, CREATOR, {
        role: 'captain',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setTeamMemberRole(EVENT_ID, TEAM_ID, 'nope', CREATOR, {
        role: 'captain',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
