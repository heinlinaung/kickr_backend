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

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.findById = jest.fn();
    playerModel.findOne = jest.fn().mockResolvedValue(null);
    memberModel.findOne = jest.fn().mockResolvedValue(null);
    imagekit.upload = jest
      .fn()
      .mockResolvedValue({ url: 'https://ik/new.jpg', fileId: 'new-file' });
    imagekit.deleteFile = jest.fn().mockResolvedValue(undefined);

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({ eventModel, playerModel, memberModel, imagekit }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  describe('submitResult', () => {
    it('records the MVP when they joined the event', async () => {
      const doc = eventDoc();
      eventModel.findById.mockResolvedValue(doc);
      playerModel.findOne.mockResolvedValue({ _id: 'row' });

      await service.submitResult(EVENT_ID, CREATOR, { mvpUserId: PLAYER });

      expect(doc.result.mvpUserId.toString()).toBe(PLAYER);
      expect(doc.save).toHaveBeenCalled();
    });

    it('rejects an MVP who never joined', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      playerModel.findOne.mockResolvedValue(null);

      // Naming a non-player would corrupt the profile mvpCount (parent §2.3).
      await expect(
        service.submitResult(EVENT_ID, CREATOR, { mvpUserId: OUTSIDER }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

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
    it('appends an uploaded photo', async () => {
      const doc = eventDoc();
      eventModel.findById.mockResolvedValue(doc);

      const res = await service.addPhoto(EVENT_ID, CREATOR, file);
      expect(res.photos).toEqual([
        { url: 'https://ik/new.jpg', fileId: 'new-file' },
      ]);
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

    it('removes a photo and deletes the remote file', async () => {
      const doc = eventDoc({
        photos: [
          { url: 'u1', fileId: 'f1' },
          { url: 'u2', fileId: 'f2' },
        ],
      });
      eventModel.findById.mockResolvedValue(doc);

      const res = await service.removePhoto(EVENT_ID, CREATOR, 'f1');

      expect(res.photos).toEqual([{ url: 'u2', fileId: 'f2' }]);
      expect(imagekit.deleteFile).toHaveBeenCalledWith('f1');
    });

    it('404s when the photo is not on the event', async () => {
      eventModel.findById.mockResolvedValue(eventDoc());
      await expect(
        service.removePhoto(EVENT_ID, CREATOR, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
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
