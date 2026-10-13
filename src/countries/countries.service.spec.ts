// src/countries/countries.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CountriesService } from './countries.service';
import { Country } from './schemas/country.schema';
import { Group } from '../groups/schemas/group.schema';
import { User } from '../users/schemas/user.schema';

const MYANMAR = {
  id: 'myanmar',
  name: 'Myanmar',
  sortOrder: 1,
  regions: [
    { id: 'yangon', name: 'Yangon' },
    { id: 'mandalay', name: 'Mandalay' },
  ],
};
const THAILAND = {
  id: 'thailand',
  name: 'Thailand',
  sortOrder: 2,
  regions: [{ id: 'chiang mai', name: 'Chiang Mai' }],
};

describe('CountriesService', () => {
  let service: CountriesService;
  let rows: any[];
  const countryModel: any = {};
  const groupModel: any = {};
  const userModel: any = {};

  const chain = (resolve: () => any) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn(async () => resolve()),
  });

  beforeEach(async () => {
    rows = [structuredClone(MYANMAR), structuredClone(THAILAND)];
    countryModel.find = jest.fn(() => chain(() => rows));
    countryModel.findOne = jest.fn((filter: any = {}) =>
      chain(() =>
        filter.id
          ? (rows.find((r) => r.id === filter.id) ?? null)
          : rows[rows.length - 1],
      ),
    );
    countryModel.exists = jest.fn(async (f: any) =>
      rows.some((r) => r.id === f.id) ? { _id: 1 } : null,
    );
    countryModel.create = jest.fn(async (doc: any) => {
      rows.push(doc);
      return doc;
    });
    countryModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    countryModel.deleteOne = jest.fn().mockResolvedValue({});
    groupModel.countDocuments = jest.fn().mockResolvedValue(0);
    userModel.countDocuments = jest.fn().mockResolvedValue(0);

    const m = await Test.createTestingModule({
      providers: [
        CountriesService,
        { provide: getModelToken(Country.name), useValue: countryModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();
    service = m.get(CountriesService);
  });

  describe('findRegionsMap', () => {
    it('keys regions by country id, in display order', async () => {
      const out = await service.findRegionsMap();

      expect(out).toEqual({
        regions: {
          myanmar: MYANMAR.regions,
          thailand: THAILAND.regions,
        },
      });
      expect(Object.keys(out.regions)).toEqual(['myanmar', 'thailand']);
    });
  });

  describe('findOne', () => {
    it('404s for an unknown country', async () => {
      await expect(service.findOne('laos')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('normalises the id', async () => {
      await expect(service.findOne('  Myanmar ')).resolves.toMatchObject({
        id: 'myanmar',
      });
    });
  });

  describe('create', () => {
    it('derives ids from names and appends sortOrder', async () => {
      await service.create({
        name: 'Viet Nam',
        regions: [{ name: 'Ho Chi Minh City' }],
      });

      expect(countryModel.create).toHaveBeenCalledWith({
        id: 'viet nam',
        name: 'Viet Nam',
        sortOrder: 3,
        regions: [{ id: 'ho chi minh city', name: 'Ho Chi Minh City' }],
      });
    });

    it('409s on an existing id', async () => {
      await expect(service.create({ name: 'Myanmar' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('400s on duplicate region ids', async () => {
      await expect(
        service.create({
          id: 'laos',
          name: 'Laos',
          regions: [{ name: 'Vientiane' }, { id: 'vientiane', name: 'V' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s when a name cannot become an id', async () => {
      await expect(service.create({ name: 'မြန်မာ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('refuses to drop a region still used as a city', async () => {
      groupModel.countDocuments.mockResolvedValueOnce(2);

      await expect(
        service.update('myanmar', { regions: [MYANMAR.regions[1]] }),
      ).rejects.toThrow(
        "Region 'yangon' of country 'myanmar' is still in use (2 groups)",
      );
      expect(groupModel.countDocuments).toHaveBeenCalledWith({
        country: 'myanmar',
        city: 'yangon',
      });
      expect(countryModel.updateOne).not.toHaveBeenCalled();
    });

    it('sets name and sortOrder', async () => {
      await service.update('myanmar', { name: 'Burma', sortOrder: 5 });

      expect(countryModel.updateOne).toHaveBeenCalledWith(
        { id: 'myanmar' },
        { $set: { name: 'Burma', sortOrder: 5 } },
      );
    });
  });

  describe('remove', () => {
    it('refuses while users store the country', async () => {
      userModel.countDocuments.mockResolvedValueOnce(4);

      await expect(service.remove('thailand')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(countryModel.deleteOne).not.toHaveBeenCalled();
    });

    it('deletes an unused country', async () => {
      await expect(service.remove('thailand')).resolves.toEqual({
        deleted: true,
        id: 'thailand',
      });
    });
  });

  describe('regions', () => {
    it('409s when adding a region id that exists', async () => {
      countryModel.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });

      await expect(
        service.addRegion('myanmar', { name: 'Yangon' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('renames a region by its id', async () => {
      await service.updateRegion('thailand', 'Chiang  Mai', 'Chiang Mai City');

      expect(countryModel.updateOne).toHaveBeenCalledWith(
        { id: 'thailand', 'regions.id': 'chiang mai' },
        { $set: { 'regions.$.name': 'Chiang Mai City' } },
      );
    });

    it('404s when removing an unknown region', async () => {
      await expect(
        service.removeRegion('myanmar', 'bangkok'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removes an unused region', async () => {
      await service.removeRegion('myanmar', 'mandalay');

      expect(countryModel.updateOne).toHaveBeenCalledWith(
        { id: 'myanmar' },
        { $pull: { regions: { id: 'mandalay' } } },
      );
    });
  });
});
