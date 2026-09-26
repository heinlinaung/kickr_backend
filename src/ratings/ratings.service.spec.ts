// src/ratings/ratings.service.spec.ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { RatingsService } from './ratings.service';
import { Rating } from './schemas/rating.schema';
import { Event } from '../events/schemas/event.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Group } from '../groups/schemas/group.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { User } from '../users/schemas/user.schema';

const RATER = '507f191e810c19729de860ea';
const OTHER = '507f191e810c19729de860eb';
const EVENT = '507f191e810c19729de860ec';
const GROUP = '507f191e810c19729de860ed';

/** A chainable query stub resolving to `result` at .lean(). */
const chain = (result: any) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});

/** A stored rating row as .lean() returns it. */
const row = (over: Partial<Record<string, any>> = {}) => ({
  _id: new Types.ObjectId(),
  targetType: 'group',
  targetId: new Types.ObjectId(GROUP),
  raterId: new Types.ObjectId(RATER),
  stars: 4,
  description: 'solid',
  isAnonymous: false,
  createdAt: new Date('2026-09-20T10:00:00Z'),
  updatedAt: new Date('2026-09-20T10:00:00Z'),
  ...over,
});

describe('RatingsService', () => {
  let service: RatingsService;

  const ratingModel: any = {};
  const eventModel: any = {};
  const playerModel: any = {};
  const groupModel: any = {};
  const memberModel: any = {};
  const userModel: any = {};

  beforeEach(async () => {
    jest.clearAllMocks();

    // Happy-path defaults: an approved group member rating someone else's
    // group. Individual tests override the arm they exercise.
    groupModel.findById = jest
      .fn()
      .mockReturnValue(chain({ _id: GROUP, ownerId: new Types.ObjectId(OTHER) }));
    memberModel.exists = jest.fn().mockResolvedValue({ _id: 'm1' });
    eventModel.findById = jest.fn().mockReturnValue(
      chain({
        _id: EVENT,
        createdBy: new Types.ObjectId(OTHER),
        status: 'after_match',
      }),
    );
    eventModel.exists = jest.fn().mockResolvedValue({ _id: EVENT });
    playerModel.exists = jest.fn().mockResolvedValue({ _id: 'p1' });
    playerModel.find = jest.fn().mockReturnValue(chain([]));
    userModel.findById = jest.fn().mockReturnValue(chain({ _id: OTHER }));
    userModel.find = jest
      .fn()
      .mockReturnValue(
        chain([{ _id: new Types.ObjectId(RATER), name: 'Hein', username: 'hein' }]),
      );
    ratingModel.findOneAndUpdate = jest.fn().mockReturnValue(chain(row()));
    ratingModel.findOne = jest.fn().mockReturnValue(chain(null));
    ratingModel.find = jest.fn().mockReturnValue(chain([]));
    ratingModel.findById = jest.fn();
    ratingModel.aggregate = jest.fn().mockResolvedValue([]);

    const m = await Test.createTestingModule({
      providers: [
        RatingsService,
        { provide: getModelToken(Rating.name), useValue: ratingModel },
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();
    service = m.get(RatingsService);
  });

  const submit = (over: Partial<Record<string, any>> = {}) =>
    service.submit(RATER, {
      targetType: 'group',
      targetId: GROUP,
      stars: 4,
      ...over,
    } as any);

  describe('target reference validation', () => {
    it("rejects an unknown targetType with the valid values in the message", async () => {
      await expect(submit({ targetType: 'venue' })).rejects.toThrow(
        /Unknown targetType 'venue'. Valid values: player, event, group/,
      );
    });

    it('rejects a malformed targetId before touching any model', async () => {
      await expect(submit({ targetId: 'not-an-id' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(groupModel.findById).not.toHaveBeenCalled();
    });
  });

  describe('eligibility — group', () => {
    it('404s an unknown group', async () => {
      groupModel.findById.mockReturnValue(chain(null));
      await expect(submit()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects the owner rating their own group with 400', async () => {
      groupModel.findById.mockReturnValue(
        chain({ _id: GROUP, ownerId: new Types.ObjectId(RATER) }),
      );
      await expect(submit()).rejects.toThrow(/cannot rate your own group/);
    });

    it('403s a non-member — and a pending request does not count', async () => {
      memberModel.exists.mockResolvedValue(null);
      await expect(submit()).rejects.toBeInstanceOf(ForbiddenException);
      // The gate must ask for APPROVED membership specifically.
      expect(memberModel.exists).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' }),
      );
    });

    it('lets an approved member through', async () => {
      await expect(submit()).resolves.toBeDefined();
    });
  });

  describe('eligibility — event', () => {
    const submitEvent = () => submit({ targetType: 'event', targetId: EVENT });

    it('404s an unknown event', async () => {
      eventModel.findById.mockReturnValue(chain(null));
      await expect(submitEvent()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects the organizer rating their own event with 400', async () => {
      eventModel.findById.mockReturnValue(
        chain({
          _id: EVENT,
          createdBy: new Types.ObjectId(RATER),
          status: 'done',
        }),
      );
      await expect(submitEvent()).rejects.toThrow(/cannot rate your own event/);
    });

    it("rejects an unfinished event, naming its status", async () => {
      eventModel.findById.mockReturnValue(
        chain({
          _id: EVENT,
          createdBy: new Types.ObjectId(OTHER),
          status: 'playing',
        }),
      );
      await expect(submitEvent()).rejects.toThrow(
        /Only a finished event can be rated \(event is 'playing'\)/,
      );
    });

    it('rejects a cancelled event — it never happened', async () => {
      eventModel.findById.mockReturnValue(
        chain({
          _id: EVENT,
          createdBy: new Types.ObjectId(OTHER),
          status: 'cancelled',
        }),
      );
      await expect(submitEvent()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('403s a caller who never joined the roster', async () => {
      playerModel.exists.mockResolvedValue(null);
      await expect(submitEvent()).rejects.toThrow(
        /Only players who joined this event/,
      );
    });

    it.each([['after_match'], ['done']])(
      "lets a joined player rate a '%s' event",
      async (status) => {
        eventModel.findById.mockReturnValue(
          chain({ _id: EVENT, createdBy: new Types.ObjectId(OTHER), status }),
        );
        await expect(submitEvent()).resolves.toBeDefined();
      },
    );
  });

  describe('eligibility — player', () => {
    const submitPlayer = () => submit({ targetType: 'player', targetId: OTHER });
    const sharedRoster = () => [
      { eventId: new Types.ObjectId(EVENT), userId: new Types.ObjectId(RATER) },
      { eventId: new Types.ObjectId(EVENT), userId: new Types.ObjectId(OTHER) },
    ];

    it('rejects rating yourself with 400', async () => {
      await expect(
        submit({ targetType: 'player', targetId: RATER }),
      ).rejects.toThrow(/cannot rate yourself/);
    });

    it('404s an unknown user', async () => {
      userModel.findById.mockReturnValue(chain(null));
      await expect(submitPlayer()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403s when the two never shared an event', async () => {
      playerModel.find.mockReturnValue(
        chain([
          {
            eventId: new Types.ObjectId(EVENT),
            userId: new Types.ObjectId(RATER),
          },
        ]),
      );
      await expect(submitPlayer()).rejects.toThrow(
        /finishing an event together/,
      );
      // No shared event -> the status check must not even run.
      expect(eventModel.exists).not.toHaveBeenCalled();
    });

    it('403s when the shared event has not finished', async () => {
      playerModel.find.mockReturnValue(chain(sharedRoster()));
      eventModel.exists.mockResolvedValue(null);
      await expect(submitPlayer()).rejects.toBeInstanceOf(ForbiddenException);
      // Finished means after_match/done — cancelled must not qualify.
      expect(eventModel.exists).toHaveBeenCalledWith(
        expect.objectContaining({
          status: { $in: ['after_match', 'done'] },
        }),
      );
    });

    it('lets a teammate from a finished event through', async () => {
      playerModel.find.mockReturnValue(chain(sharedRoster()));
      await expect(submitPlayer()).resolves.toBeDefined();
    });
  });

  describe('submit — one editable rating per target', () => {
    it('upserts on (raterId, targetType, targetId)', async () => {
      await submit({ stars: 5, description: 'great', isAnonymous: true });

      const [filter, update, options] =
        ratingModel.findOneAndUpdate.mock.calls[0];
      expect(filter.raterId.toString()).toBe(RATER);
      expect(filter.targetType).toBe('group');
      expect(filter.targetId.toString()).toBe(GROUP);
      expect(update.$set).toEqual({
        stars: 5,
        description: 'great',
        isAnonymous: true,
      });
      expect(options).toMatchObject({ new: true, upsert: true });
    });

    it('an omitted description clears the previous one', async () => {
      // The upsert REPLACES the review; keeping old text under a new star
      // value would misquote the rater.
      await submit({ stars: 2 });
      const [, update] = ratingModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set.description).toBeNull();
      expect(update.$set.isAnonymous).toBe(false);
    });

    it('returns the stored rating shaped for its author', async () => {
      const res: any = await submit();
      expect(res.mine).toBe(true);
      expect(res.stars).toBe(4);
      expect(res.rater).toMatchObject({ name: 'Hein' });
    });
  });

  describe('list — anonymity is a display rule', () => {
    const anonRow = () => row({ isAnonymous: true });

    it('masks an anonymous rater from other viewers', async () => {
      ratingModel.find.mockReturnValue(chain([anonRow()]));
      const page: any = await service.list('group', GROUP, 20, undefined, OTHER);

      expect(page.items[0].rater).toBeNull();
      expect(page.items[0].isAnonymous).toBe(true);
      expect(page.items[0].mine).toBe(false);
    });

    it("never even looks up an anonymous rater's user document", async () => {
      // The mask must hold at the query layer, not just the response shape:
      // the id of a hidden rater should not leave the service.
      ratingModel.find.mockReturnValue(chain([anonRow()]));
      await service.list('group', GROUP, 20, undefined, OTHER);

      expect(userModel.find).not.toHaveBeenCalled();
    });

    it('shows the author their own anonymous rating, flagged mine', async () => {
      ratingModel.find.mockReturnValue(chain([anonRow()]));
      const page: any = await service.list('group', GROUP, 20, undefined, RATER);

      expect(page.items[0].mine).toBe(true);
      expect(page.items[0].rater).toMatchObject({ name: 'Hein' });
    });

    it('shows a named rater to everyone', async () => {
      ratingModel.find.mockReturnValue(chain([row()]));
      const page: any = await service.list('group', GROUP, 20, undefined, OTHER);

      expect(page.items[0].rater).toMatchObject({
        name: 'Hein',
        username: 'hein',
      });
    });

    it('pages newest first with a lookahead row', async () => {
      const rows = [row(), row(), row()];
      ratingModel.find.mockReturnValue(chain(rows));
      const page: any = await service.list('group', GROUP, 2, undefined, RATER);

      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toEqual(expect.any(String));
      const query = ratingModel.find.mock.results[0].value;
      expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(query.limit).toHaveBeenCalledWith(3); // pageSize + 1
    });
  });

  describe('summary — computed on read', () => {
    it('folds the star buckets into average, count and breakdown', async () => {
      ratingModel.aggregate.mockResolvedValue([
        { _id: 5, count: 2 },
        { _id: 3, count: 1 },
      ]);

      const res: any = await service.summary('group', GROUP, RATER);

      expect(res.count).toBe(3);
      expect(res.average).toBe(4.3); // 13/3 rounded to 1 decimal
      expect(res.breakdown).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 });
    });

    it('reports zeros for an unrated target', async () => {
      const res: any = await service.summary('group', GROUP, RATER);
      expect(res).toMatchObject({ count: 0, average: 0, myRating: null });
    });

    it("includes the caller's own rating for pre-filling the form", async () => {
      ratingModel.findOne.mockReturnValue(chain(row({ stars: 2 })));
      const res: any = await service.summary('group', GROUP, RATER);
      expect(res.myRating).toMatchObject({ stars: 2, mine: true });
    });
  });

  describe('remove — author only', () => {
    it('400s a malformed id', async () => {
      await expect(service.remove('nope', RATER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s a missing rating', async () => {
      ratingModel.findById.mockResolvedValue(null);
      await expect(service.remove(GROUP, RATER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("403s anyone who is not the rating's author", async () => {
      ratingModel.findById.mockResolvedValue({
        raterId: new Types.ObjectId(RATER),
        deleteOne: jest.fn(),
      });
      await expect(service.remove(GROUP, OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('deletes the author’s own rating', async () => {
      const doc = {
        raterId: new Types.ObjectId(RATER),
        deleteOne: jest.fn().mockResolvedValue(undefined),
      };
      ratingModel.findById.mockResolvedValue(doc);

      await expect(service.remove(GROUP, RATER)).resolves.toMatchObject({
        message: 'Rating deleted',
      });
      expect(doc.deleteOne).toHaveBeenCalled();
    });
  });

  describe('averageForPlayer — the profile statistics hook', () => {
    it('averages player ratings to 1 decimal', async () => {
      ratingModel.aggregate.mockResolvedValue([{ average: 4.25 }]);
      await expect(service.averageForPlayer(OTHER)).resolves.toBe(4.3);
      // Player ratings only — event/group stars must not leak into a profile.
      const [pipeline] = ratingModel.aggregate.mock.calls[0];
      expect(pipeline[0].$match.targetType).toBe('player');
    });

    it('is 0 for an unrated player — same value as the old stub', async () => {
      await expect(service.averageForPlayer(OTHER)).resolves.toBe(0);
    });

    it('is 0 for a malformed id rather than throwing', async () => {
      await expect(service.averageForPlayer('nope')).resolves.toBe(0);
      expect(ratingModel.aggregate).not.toHaveBeenCalled();
    });
  });
});
