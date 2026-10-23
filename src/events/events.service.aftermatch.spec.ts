// src/events/events.service.aftermatch.spec.ts
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
const PLAYER = '507f191e810c19729de860e1';
const OUTSIDER = '507f191e810c19729de860ef';
const GROUP_ID = '507f1f77bcf86cd799439099';
const OTHER_GROUP = '507f1f77bcf86cd799439098';
const CHALLENGE_ID = '507f1f77bcf86cd799439097';

const eventDoc = (over: Record<string, unknown> = {}) => {
  const doc: any = {
    _id: new Types.ObjectId(EVENT_ID),
    createdBy: new Types.ObjectId(CREATOR),
    groupId: null,
    status: 'after_match',
    photos: [],
    result: null,
    coverImage: null,
    coverImageFileId: null,
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

const file = { buffer: Buffer.from('img') } as Express.Multer.File;

describe('EventsService — after-match (spec §4.4)', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};
  const imagekit: any = {};
  const photosService: any = {};
  const awards: any = {};
  const challengeModel: any = {};
  const matchModel: any = {};
  const teamChatModel: any = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.findById = jest.fn();
    playerModel.findOne = jest.fn().mockResolvedValue(null);
    memberModel.findOne = jest.fn().mockResolvedValue(null);
    Object.assign(photosService, {
      add: jest.fn().mockResolvedValue({ photos: [] }),
      remove: jest.fn().mockResolvedValue({ photos: [] }),
    });
    imagekit.upload = jest
      .fn()
      .mockResolvedValue({ url: 'https://ik/new.jpg', fileId: 'new-file' });
    imagekit.deleteFile = jest.fn().mockResolvedValue(undefined);
    awards.giveMvp = jest.fn().mockResolvedValue({ id: 'aw_1' });
    awards.revokeMvp = jest.fn().mockResolvedValue(undefined);
    awards.giveChallengeAward = jest.fn().mockResolvedValue(null);
    challengeModel.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        challengerGroupId: new Types.ObjectId(GROUP_ID),
        challengedGroupId: new Types.ObjectId(OTHER_GROUP),
      }),
    });
    matchModel.find = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    teamChatModel.updateMany = jest.fn().mockResolvedValue({});

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          playerModel,
          memberModel,
          imagekit,
          photosService,
          awards,
          challengeModel,
          matchModel,
          teamChatModel,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  describe('submitResult — score only, MVP moved to submitMvp', () => {
    it.each(['join', 'before_match', 'preparation', 'playing', 'done'])(
      'rejects a result while %s',
      async (status) => {
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(
          service.submitResult(EVENT_ID, CREATOR, {}),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('accepts an overall score for a simple 2-team event', async () => {
      const doc = eventDoc();
      eventModel.findById.mockResolvedValue(doc);

      await service.submitResult(EVENT_ID, CREATOR, { scoreA: 3, scoreB: 1 });
      expect(doc.result).toMatchObject({
        scoreA: 3,
        scoreB: 1,
        mvpUserId: null,
      });
    });

    it('preserves an MVP recorded earlier — correcting a score cannot blank it', async () => {
      const doc = eventDoc({
        result: {
          mvpUserId: new Types.ObjectId(PLAYER),
          mvpGoal: 12,
          mvpAssist: 4,
          scoreA: null,
          scoreB: null,
        },
      });
      eventModel.findById.mockResolvedValue(doc);

      await service.submitResult(EVENT_ID, CREATOR, { scoreA: 3, scoreB: 1 });

      expect(doc.result.mvpUserId.toString()).toBe(PLAYER);
      expect(doc.result.mvpGoal).toBe(12);
      expect(doc.result.mvpAssist).toBe(4);
      expect(doc.result).toMatchObject({ scoreA: 3, scoreB: 1 });
    });
  });

  describe('submitMvp — POST /events/:id/mvp', () => {
    it('records the MVP and their goal/assist counts when they joined the event', async () => {
      const doc = eventDoc();
      eventModel.findById.mockResolvedValue(doc);
      playerModel.findOne.mockResolvedValue({ _id: 'row' });

      await service.submitMvp(EVENT_ID, CREATOR, {
        userId: PLAYER,
        goal: 12,
        assist: 4,
      });

      expect(doc.result.mvpUserId.toString()).toBe(PLAYER);
      expect(doc.result.mvpGoal).toBe(12);
      expect(doc.result.mvpAssist).toBe(4);
      expect(doc.save).toHaveBeenCalled();
    });

    it('rejects an MVP who never joined', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      playerModel.findOne.mockResolvedValue(null);

      // Naming a non-player would corrupt the profile mvpCount (parent §2.3).
      await expect(
        service.submitMvp(EVENT_ID, CREATOR, {
          userId: OUTSIDER,
          goal: 1,
          assist: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['join', 'before_match', 'preparation', 'playing', 'done'])(
      'rejects an MVP while %s — same window as the result',
      async (status) => {
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(
          service.submitMvp(EVENT_ID, CREATOR, {
            userId: PLAYER,
            goal: 1,
            assist: 0,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('preserves a score recorded earlier — either order works', async () => {
      const doc = eventDoc({
        result: {
          mvpUserId: null,
          mvpGoal: null,
          mvpAssist: null,
          scoreA: 3,
          scoreB: 1,
        },
      });
      eventModel.findById.mockResolvedValue(doc);
      playerModel.findOne.mockResolvedValue({ _id: 'row' });

      await service.submitMvp(EVENT_ID, CREATOR, {
        userId: PLAYER,
        goal: 12,
        assist: 4,
      });

      expect(doc.result).toMatchObject({
        scoreA: 3,
        scoreB: 1,
        mvpGoal: 12,
        mvpAssist: 4,
      });
    });
  });

  describe('submitMvp keeps the MVP award in step', () => {
    it('gives the award, replacing a different holder', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ title: 'Sunday' }));
      playerModel.findOne.mockResolvedValue({ _id: 'row' });

      await service.submitMvp(EVENT_ID, CREATOR, {
        userId: PLAYER,
        goal: 1,
        assist: 0,
      });

      expect(awards.giveMvp).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: PLAYER,
          awardedBy: CREATOR,
          replace: true,
        }),
      );
    });
  });

  describe('awardMvp — POST|PATCH /events/:id/awards/mvp', () => {
    const code = async (p: Promise<unknown>) =>
      p.then(
        () => 'resolved',
        (err: any) => err.getResponse().code,
      );

    it.each(['after_match', 'done'])('awards while %s', async (status) => {
      const doc = eventDoc({ status });
      eventModel.findById.mockResolvedValue(doc);
      playerModel.findOne.mockResolvedValue({ _id: 'row' });

      const award = await service.awardMvp(EVENT_ID, CREATOR, {
        userId: PLAYER,
        note: '2 goals',
      });

      expect(award).toEqual({ id: 'aw_1' });
      expect(awards.giveMvp).toHaveBeenCalledWith(
        expect.objectContaining({ userId: PLAYER, note: '2 goals' }),
      );
      expect(awards.giveMvp.mock.calls[0][0].replace).toBeUndefined();
      expect(doc.result.mvpUserId.toString()).toBe(PLAYER);
    });

    it('drops goal/assist when the MVP changes, keeps them when it does not', async () => {
      const stale = eventDoc({
        result: {
          mvpUserId: new Types.ObjectId(OUTSIDER),
          mvpGoal: 5,
          mvpAssist: 2,
          scoreA: 1,
          scoreB: 0,
        },
      });
      eventModel.findById.mockResolvedValue(stale);
      playerModel.findOne.mockResolvedValue({ _id: 'row' });
      await service.awardMvp(EVENT_ID, CREATOR, { userId: PLAYER });
      expect(stale.result).toMatchObject({
        mvpGoal: null,
        mvpAssist: null,
        scoreA: 1,
      });

      const same = eventDoc({
        result: {
          mvpUserId: new Types.ObjectId(PLAYER),
          mvpGoal: 5,
          mvpAssist: 2,
          scoreA: 1,
          scoreB: 0,
        },
      });
      eventModel.findById.mockResolvedValue(same);
      await service.awardMvp(EVENT_ID, CREATOR, { userId: PLAYER });
      expect(same.result).toMatchObject({ mvpGoal: 5, mvpAssist: 2 });
    });

    it('EVENT_NOT_FINISHED before the match is over', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'playing' }));
      expect(
        await code(service.awardMvp(EVENT_ID, CREATOR, { userId: PLAYER })),
      ).toBe('EVENT_NOT_FINISHED');
    });

    it('USER_NOT_IN_EVENT for a non-player', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      expect(
        await code(service.awardMvp(EVENT_ID, CREATOR, { userId: OUTSIDER })),
      ).toBe('USER_NOT_IN_EVENT');
    });

    it('NOT_EVENT_ORGANIZER for anyone else', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      const err: any = await service
        .awardMvp(EVENT_ID, OUTSIDER, { userId: PLAYER })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse().code).toBe('NOT_EVENT_ORGANIZER');
    });
  });

  describe('revokeMvp — DELETE /events/:id/awards/mvp', () => {
    it('takes the award back and clears the MVP, keeping the score', async () => {
      const doc = eventDoc({
        result: {
          mvpUserId: new Types.ObjectId(PLAYER),
          mvpGoal: 5,
          mvpAssist: 2,
          scoreA: 3,
          scoreB: 1,
        },
      });
      eventModel.findById.mockResolvedValue(doc);

      await service.revokeMvp(EVENT_ID, CREATOR);

      expect(awards.revokeMvp).toHaveBeenCalledWith(EVENT_ID);
      expect(doc.result).toEqual({
        mvpUserId: null,
        mvpGoal: null,
        mvpAssist: null,
        scoreA: 3,
        scoreB: 1,
      });
    });
  });

  describe('Group Challenge award on done', () => {
    const challengeEvent = (over: Record<string, unknown> = {}) =>
      eventDoc({
        type: 'challenge',
        proposedStatus: 'accepted',
        challengeId: new Types.ObjectId(CHALLENGE_ID),
        groupId: new Types.ObjectId(GROUP_ID),
        sportType: 'basketball',
        challengeColors: { challengerColor: 'Red', challengedColor: 'Blue' },
        ...over,
      });
    // The creator keeps organizer rights, so no membership is needed; done
    // is reachable from after_match for every table.
    const finish = async (doc: any) => {
      eventModel.findById.mockResolvedValue(doc);
      await service.setStatus(EVENT_ID, CREATOR, 'done');
    };

    it('awards the challenger when scoreA wins', async () => {
      await finish(challengeEvent({ result: { scoreA: 3, scoreB: 1 } }));
      expect(awards.giveChallengeAward).toHaveBeenCalledWith(
        expect.objectContaining({
          winnerGroupId: new Types.ObjectId(GROUP_ID),
        }),
      );
    });

    it('awards the challenged side when scoreB wins', async () => {
      await finish(challengeEvent({ result: { scoreA: 0, scoreB: 2 } }));
      expect(
        awards.giveChallengeAward.mock.calls[0][0].winnerGroupId.toString(),
      ).toBe(OTHER_GROUP);
    });

    it('gives nothing on a draw', async () => {
      await finish(challengeEvent({ result: { scoreA: 2, scoreB: 2 } }));
      expect(awards.giveChallengeAward).not.toHaveBeenCalled();
    });

    it('falls back to fixture goals when no overall score was posted', async () => {
      matchModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { teamA: 'Red', teamB: 'Blue', scoreA: 1, scoreB: 2 },
          { teamA: 'Blue', teamB: 'Red', scoreA: 0, scoreB: 0 },
          { teamA: 'Red', teamB: 'Blue', scoreA: null, scoreB: null },
        ]),
      });
      await finish(challengeEvent());
      expect(
        awards.giveChallengeAward.mock.calls[0][0].winnerGroupId.toString(),
      ).toBe(OTHER_GROUP);
    });

    it('gives nothing when nothing was scored', async () => {
      await finish(challengeEvent());
      expect(awards.giveChallengeAward).not.toHaveBeenCalled();
    });

    it('never awards a normal event', async () => {
      await finish(eventDoc({ result: { scoreA: 3, scoreB: 1 } }));
      expect(awards.giveChallengeAward).not.toHaveBeenCalled();
    });

    it('an award failure does not block the archive', async () => {
      awards.giveChallengeAward.mockRejectedValue(new Error('db down'));
      const doc = challengeEvent({ result: { scoreA: 3, scoreB: 1 } });
      await finish(doc);
      expect(doc.status).toBe('done');
    });
  });

  describe('setCover', () => {
    it('stores the uploaded url and fileId', async () => {
      const doc = eventDoc({ status: 'join' });
      eventModel.findById.mockResolvedValue(doc);

      const res = await service.setCover(EVENT_ID, CREATOR, file);

      expect(res).toEqual({
        coverImage: 'https://ik/new.jpg',
        coverImageFileId: 'new-file',
      });
      expect(doc.coverImage).toBe('https://ik/new.jpg');
    });

    it('deletes the previous file only after the new one is saved', async () => {
      const doc = eventDoc({ status: 'join', coverImageFileId: 'old-file' });
      eventModel.findById.mockResolvedValue(doc);

      await service.setCover(EVENT_ID, CREATOR, file);

      expect(imagekit.deleteFile).toHaveBeenCalledWith('old-file');
      // Order matters: deleting first would lose the cover if the upload then
      // failed. Compare invocation order rather than pulling in jest-extended.
      expect(doc.save.mock.invocationCallOrder[0]).toBeLessThan(
        imagekit.deleteFile.mock.invocationCallOrder[0],
      );
    });

    it('still succeeds when deleting the old file fails', async () => {
      eventModel.findById.mockResolvedValue(
        eventDoc({ status: 'join', coverImageFileId: 'old-file' }),
      );
      imagekit.deleteFile.mockRejectedValue(new Error('imagekit down'));

      // An orphaned remote file is better than a failed request.
      await expect(
        service.setCover(EVENT_ID, CREATOR, file),
      ).resolves.toBeDefined();
    });

    it('rejects a cover on a completed event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc({ status: 'done' }));
      await expect(
        service.setCover(EVENT_ID, CREATOR, file),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('photos', () => {
    // Photos moved OUT of the event document into the shared `photos`
    // collection, so these assert DELEGATION rather than a mutated array.
    // The storage move is what puts an event's photo in its group's gallery.
    it('delegates the upload, tagging it with the event and its group', async () => {
      const doc = eventDoc({ groupId: GROUP_ID });
      eventModel.findById.mockResolvedValue(doc);

      await service.addPhoto(EVENT_ID, CREATOR, file);

      expect(photosService.add).toHaveBeenCalledWith(
        'event',
        EVENT_ID,
        CREATOR,
        file,
        // The denormalised link: this is the ONLY reason the photo shows up
        // under GET /groups/:id/photos.
        String(GROUP_ID),
      );
    });

    it('passes a null groupId for a standalone event', async () => {
      // No group means no gallery for it to appear in.
      eventModel.findById.mockResolvedValue(eventDoc({ groupId: null }));

      await service.addPhoto(EVENT_ID, CREATOR, file);

      expect(photosService.add.mock.calls[0][4]).toBeNull();
    });

    it('does not upload to ImageKit itself', async () => {
      // The service no longer owns the upload; PhotosService does, so it can
      // enforce the per-target cap BEFORE anything reaches ImageKit.
      eventModel.findById.mockResolvedValue(eventDoc());

      await service.addPhoto(EVENT_ID, CREATOR, file);

      expect(imagekit.upload).not.toHaveBeenCalled();
    });

    it.each(['join', 'before_match', 'preparation', 'playing', 'done'])(
      'rejects a photo while %s',
      async (status) => {
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(
          service.addPhoto(EVENT_ID, CREATOR, file),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('delegates the removal, scoped to this event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());

      await service.removePhoto(EVENT_ID, CREATOR, 'f1');

      // Scoped to ('event', EVENT_ID) so a fileId belonging to another target
      // cannot be deleted through this route.
      expect(photosService.remove).toHaveBeenCalledWith(
        'event',
        EVENT_ID,
        'f1',
      );
    });

    it('still checks the organizer before removing', async () => {
      // Delegation must not have dropped the permission check on the way.
      eventModel.findById.mockResolvedValue(eventDoc());
      memberModel.findOne.mockResolvedValue(null);

      await expect(
        service.removePhoto(EVENT_ID, OUTSIDER, 'f1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(photosService.remove).not.toHaveBeenCalled();
    });
  });

  describe('organizer gating', () => {
    it('refuses a stranger', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(
        service.submitResult(EVENT_ID, OUTSIDER, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
