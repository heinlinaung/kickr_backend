// src/users/users.delete-account.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Event } from '../events/schemas/event.schema';
import { GlobalFootballTeam } from '../global-football-teams/schemas/global-football-team.schema';
import { Group } from '../groups/schemas/group.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import { SportTypesService } from '../sport-types/sport-types.service';
import { RatingsService } from '../ratings/ratings.service';
import { EventsService } from '../events/events.service';
import {
  sportTypesDouble,
  ratingsDouble,
} from '../events/events.test-providers';

const USER = '507f191e810c19729de860e1';

describe('UsersService.deleteAccount — DELETE /users/me (soft delete)', () => {
  let service: UsersService;

  const userModel: any = {};
  const groupModel: any = {};
  const eventModel: any = {};
  const playerModel: any = {};
  const eventsService = { cancel: jest.fn(), leave: jest.fn() };

  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Happy path: a live account owning nothing, organizing nothing, joined
    // to nothing. Tests override the arm they exercise.
    userModel.findById = jest
      .fn()
      .mockReturnValue(chain({ _id: USER, deletedAt: null }));
    userModel.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    groupModel.find = jest.fn().mockReturnValue(chain([]));
    eventModel.find = jest.fn().mockReturnValue(chain([]));
    playerModel.find = jest.fn().mockReturnValue(chain([]));
    eventsService.cancel.mockResolvedValue({});
    eventsService.leave.mockResolvedValue({});

    const m = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(GlobalFootballTeam.name), useValue: {} },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: ImageKitService, useValue: {} },
        { provide: SportTypesService, useValue: sportTypesDouble() },
        { provide: RatingsService, useValue: ratingsDouble() },
        { provide: EventsService, useValue: eventsService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = m.get(UsersService);
  });

  describe('guards — a rejected request changes nothing', () => {
    it('404s an unknown user', async () => {
      userModel.findById.mockReturnValue(chain(null));
      await expect(service.deleteAccount(USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('400s an already-deleted account instead of re-running the cascade', async () => {
      userModel.findById.mockReturnValue(
        chain({ _id: USER, deletedAt: new Date() }),
      );
      await expect(service.deleteAccount(USER)).rejects.toThrow(
        /already been deleted/,
      );
      expect(eventsService.cancel).not.toHaveBeenCalled();
    });

    it('blocks while the caller still owns groups, naming them', async () => {
      groupModel.find.mockReturnValue(
        chain([{ name: 'Second FC' }, { name: 'Aura Bangkok' }]),
      );

      await expect(service.deleteAccount(USER)).rejects.toThrow(
        /You still own 2 group\(s\): 'Second FC', 'Aura Bangkok'/,
      );

      // The guard is a pre-flight, not a partial run: no cancel, no leave,
      // no flag.
      expect(eventsService.cancel).not.toHaveBeenCalled();
      expect(eventsService.leave).not.toHaveBeenCalled();
      expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('the ownership check queries by the caller as owner', async () => {
      await service.deleteAccount(USER);
      const [filter] = groupModel.find.mock.calls[0];
      expect(filter.ownerId.toString()).toBe(USER);
    });
  });

  describe('cancelling the events they organize', () => {
    it('cancels each UNFINISHED created event through the real cancel flow', async () => {
      const e1 = new Types.ObjectId();
      const e2 = new Types.ObjectId();
      eventModel.find.mockReturnValueOnce(chain([{ _id: e1 }, { _id: e2 }]));

      await service.deleteAccount(USER);

      expect(eventsService.cancel).toHaveBeenCalledTimes(2);
      expect(eventsService.cancel).toHaveBeenCalledWith(e1.toString(), USER, {
        reason: 'Organizer account deleted',
      });
    });

    it('asks only for unfinished events — history is not re-cancelled', async () => {
      await service.deleteAccount(USER);

      const [filter] = eventModel.find.mock.calls[0];
      expect(filter.createdBy.toString()).toBe(USER);
      // after_match/done are history and cancelled is already cancelled.
      expect(filter.status).toEqual({
        $nin: ['after_match', 'done', 'cancelled'],
      });
    });
  });

  describe('leaving rosters they joined', () => {
    it("leaves each event still in 'join' via the real leave flow", async () => {
      const open = new Types.ObjectId();
      playerModel.find.mockReturnValue(chain([{ eventId: open }]));
      // Second eventModel.find call resolves which joined events are open.
      eventModel.find
        .mockReturnValueOnce(chain([])) // organized
        .mockReturnValueOnce(chain([{ _id: open }])); // still open

      await service.deleteAccount(USER);

      // leave() also decrements joinedCount and cascades their guests —
      // which is exactly why the real flow is reused here.
      expect(eventsService.leave).toHaveBeenCalledWith(open.toString(), USER);
    });

    it("filters the joined events to status 'join' — later stages keep the roster", async () => {
      playerModel.find.mockReturnValue(
        chain([{ eventId: new Types.ObjectId() }]),
      );
      eventModel.find
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));

      await service.deleteAccount(USER);

      const [filter] = eventModel.find.mock.calls[1];
      // Past 'join', the roster is referenced by teams and fixtures; pulling
      // the player would corrupt them — same rule as self-leave.
      expect(filter.status).toBe('join');
      expect(eventsService.leave).not.toHaveBeenCalled();
    });

    it('skips the event lookup entirely when they joined nothing', async () => {
      await service.deleteAccount(USER);
      // Only the organized-events query ran.
      expect(eventModel.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('the flag', () => {
    it('stamps deletedAt last and reports success', async () => {
      await expect(service.deleteAccount(USER)).resolves.toEqual({
        message: 'Account deleted',
      });

      const [, update] = userModel.findByIdAndUpdate.mock.calls[0];
      expect(update.$set.deletedAt).toBeInstanceOf(Date);
    });

    it('destroys nothing — no user document deletion, ever', async () => {
      await service.deleteAccount(USER);
      // Soft delete: the only write to the user is the flag.
      expect(userModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
