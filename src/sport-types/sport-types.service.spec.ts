// src/sport-types/sport-types.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { SportTypesService } from './sport-types.service';
import { SportType } from './schemas/sport-type.schema';

const ROWS = [
  { value: 'football', subTypes: ['futsal', 'stadium'], sortOrder: 1 },
  { value: 'futsal', subTypes: [], sortOrder: 2 },
  { value: 'badminton', subTypes: [], sortOrder: 3 },
];

describe('SportTypesService', () => {
  let service: SportTypesService;
  const sportTypeModel: any = {};

  /** One chainable stub answers both findAll and findByValue query shapes. */
  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    sportTypeModel.find = jest.fn().mockReturnValue(chain(ROWS));

    const m = await Test.createTestingModule({
      providers: [
        SportTypesService,
        { provide: getModelToken(SportType.name), useValue: sportTypeModel },
      ],
    }).compile();
    service = m.get(SportTypesService);
  });

  describe('findAll', () => {
    it('returns the collection in display order', async () => {
      const out = await service.findAll();

      expect(out).toEqual(ROWS);
      const query = sportTypeModel.find.mock.results[0].value;
      expect(query.sort).toHaveBeenCalledWith({ sortOrder: 1, value: 1 });
    });
  });

  describe('findByValue', () => {
    it('returns the row, or null when the sport is unknown', async () => {
      sportTypeModel.find.mockReturnValue(chain([ROWS[0]]));
      expect(await service.findByValue('football')).toEqual(ROWS[0]);

      sportTypeModel.find.mockReturnValue(chain([]));
      expect(await service.findByValue('cricket')).toBeNull();
    });
  });

  describe('assertValid', () => {
    it('accepts a seeded sport', async () => {
      await expect(service.assertValid('badminton')).resolves.toBeUndefined();
    });

    it('rejects an unknown sport, naming the valid values', async () => {
      await expect(service.assertValid('cricket')).rejects.toThrow(
        /Unknown sportType 'cricket'.*football, futsal, badminton/,
      );
      await expect(service.assertValid('cricket')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts a subType the sport lists', async () => {
      await expect(
        service.assertValid('football', 'stadium'),
      ).resolves.toBeUndefined();
    });

    it('rejects a subType on a sport with no formats', async () => {
      await expect(service.assertValid('futsal', 'stadium')).rejects.toThrow(
        /not valid for sportType 'futsal'/,
      );
    });

    it('rejects an unknown subType, naming the valid formats', async () => {
      await expect(service.assertValid('football', 'beach')).rejects.toThrow(
        /Unknown subType 'beach'.*futsal, stadium/,
      );
    });

    it('treats null subType as absent — how update() passes a cleared one', async () => {
      await expect(
        service.assertValid('futsal', null),
      ).resolves.toBeUndefined();
    });
  });
});
