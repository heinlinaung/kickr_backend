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

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          playerModel,
          memberModel,
          imagekit,
          photosService,
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
      expect(doc.result).toMatchObject({ scoreA: 3, scoreB: 1, mvpUserId: null });
    });

    it('preserves an MVP recorded earlier — correcting a score cannot blank it', async () => {
      const doc = eventDoc({
        result: {
          mvpUserId: new Types.ObjectId(PLAYER),
          mvpGoal: 12,
          scoreA: null,
          scoreB: null,
        },
      });
      eventModel.findById.mockResolvedValue(doc);

      await service.submitResult(EVENT_ID, CREATOR, { scoreA: 3, scoreB: 1 });

      expect(doc.result.mvpUserId.toString()).toBe(PLAYER);
      expect(doc.result.mvpGoal).toBe(12);
      expect(doc.result).toMatchObject({ scoreA: 3, scoreB: 1 });
    });
  });

  describe('submitMvp — POST /events/:id/mvp', () => {
    it('records the MVP and their goal count when they joined the event', async () => {
      const doc = eventDoc();
      eventModel.findById.mockResolvedValue(doc);
      playerModel.findOne.mockResolvedValue({ _id: 'row' });

      await service.submitMvp(EVENT_ID, CREATOR, { userId: PLAYER, goal: 12 });

      expect(doc.result.mvpUserId.toString()).toBe(PLAYER);
      expect(doc.result.mvpGoal).toBe(12);
      expect(doc.save).toHaveBeenCalled();
    });

    it('rejects an MVP who never joined', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      playerModel.findOne.mockResolvedValue(null);

      // Naming a non-player would corrupt the profile mvpCount (parent §2.3).
      await expect(
        service.submitMvp(EVENT_ID, CREATOR, { userId: OUTSIDER, goal: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['join', 'before_match', 'preparation', 'playing', 'done'])(
      'rejects an MVP while %s — same window as the result',
      async (status) => {
        eventModel.findById.mockResolvedValue(eventDoc({ status }));
        await expect(
          service.submitMvp(EVENT_ID, CREATOR, { userId: PLAYER, goal: 1 }),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('preserves a score recorded earlier — either order works', async () => {
      const doc = eventDoc({
        result: { mvpUserId: null, mvpGoal: null, scoreA: 3, scoreB: 1 },
      });
      eventModel.findById.mockResolvedValue(doc);
      playerModel.findOne.mockResolvedValue({ _id: 'row' });

      await service.submitMvp(EVENT_ID, CREATOR, { userId: PLAYER, goal: 12 });

      expect(doc.result).toMatchObject({ scoreA: 3, scoreB: 1, mvpGoal: 12 });
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
