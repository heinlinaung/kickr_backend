// src/sport-types/sport-types.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SportTypesService } from './sport-types.service';
import { SportType } from './schemas/sport-type.schema';
import { Group } from '../groups/schemas/group.schema';
import { Event } from '../events/schemas/event.schema';
import { EventTemplate } from '../events/schemas/event-template.schema';
import { User } from '../users/schemas/user.schema';

const ROWS = [
  { value: 'football', subTypes: ['futsal', 'stadium'], sortOrder: 1 },
  { value: 'futsal', subTypes: [], sortOrder: 2 },
  { value: 'badminton', subTypes: [], sortOrder: 3 },
];

describe('SportTypesService', () => {
  let service: SportTypesService;
  const sportTypeModel: any = {};
  const groupModel: any = {};
  const eventModel: any = {};
  const templateModel: any = {};
  const userModel: any = {};

  /** One chainable stub answers both findAll and findByValue query shapes. */
  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  /** Stub for findOne(...).select().lean() and findOne().sort().select().lean(). */
  const one = (result: any) => chain(result);

  beforeEach(async () => {
    jest.clearAllMocks();
    sportTypeModel.find = jest.fn().mockReturnValue(chain(ROWS));
    // findOne answers by the queried value, from ROWS.
    sportTypeModel.findOne = jest.fn((filter: any = {}) =>
      one(
        filter.value
          ? (ROWS.find((r) => r.value === filter.value) ?? null)
          : ROWS[ROWS.length - 1],
      ),
    );
    sportTypeModel.exists = jest.fn().mockResolvedValue(null);
    sportTypeModel.create = jest.fn(async (doc: any) => doc);
    sportTypeModel.updateOne = jest.fn().mockResolvedValue({});
    sportTypeModel.deleteOne = jest.fn().mockResolvedValue({});
    for (const m of [groupModel, eventModel, templateModel, userModel]) {
      m.countDocuments = jest.fn().mockResolvedValue(0);
    }

    const m = await Test.createTestingModule({
      providers: [
        SportTypesService,
        { provide: getModelToken(SportType.name), useValue: sportTypeModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(Event.name), useValue: eventModel },
        {
          provide: getModelToken(EventTemplate.name),
          useValue: templateModel,
        },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();
    service = m.get(SportTypesService);
  });

  describe('findAll', () => {
    it('returns the collection in display order', async () => {
      const out = await service.findAll();

      expect(out).toEqual(
        ROWS.map((r) => ({
          ...r,
          name: r.value,
          matchProvided: true,
          playerRoles: [],
        })),
      );
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

  describe('findOne', () => {
    it('404s an unknown sport', async () => {
      await expect(service.findOne('cricket')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('appends after the last sport when sortOrder is omitted, deduping subTypes', async () => {
      sportTypeModel.findOne
        .mockReturnValueOnce(one(ROWS[2])) // last by sortOrder
        .mockReturnValueOnce(
          one({ value: 'tennis', subTypes: ['singles'], sortOrder: 4 }),
        );

      await service.create({
        value: 'tennis',
        subTypes: ['singles', 'singles'],
      });

      expect(sportTypeModel.create).toHaveBeenCalledWith({
        value: 'tennis',
        name: 'tennis',
        subTypes: ['singles'],
        playerRoles: [],
        sortOrder: 4,
        matchProvided: true,
      });
    });

    it('stores playerRoles, deduped and in order', async () => {
      sportTypeModel.findOne
        .mockReturnValueOnce(one(ROWS[2])) // last by sortOrder
        .mockReturnValueOnce(one({ value: 'hockey' }));

      await service.create({
        value: 'hockey',
        playerRoles: ['goalkeeper', 'forward', 'goalkeeper'],
      });

      expect(sportTypeModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ playerRoles: ['goalkeeper', 'forward'] }),
      );
    });

    it('stores matchProvided: false when sent', async () => {
      sportTypeModel.findOne
        .mockReturnValueOnce(one(ROWS[2])) // last by sortOrder
        .mockReturnValueOnce(one({ value: 'yoga', matchProvided: false }));

      await service.create({ value: 'yoga', matchProvided: false });

      expect(sportTypeModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'yoga', matchProvided: false }),
      );
    });

    it('409s a name another sport has', async () => {
      sportTypeModel.exists
        .mockResolvedValueOnce(null) // value is free
        .mockResolvedValueOnce({ _id: 'x' }); // name is taken
      await expect(
        service.create({ value: 'soccer', name: 'Football' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sportTypeModel.create).not.toHaveBeenCalled();
    });

    it('409s a duplicate value', async () => {
      sportTypeModel.exists.mockResolvedValue({ _id: 'x' });
      await expect(
        service.create({ value: 'football' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sportTypeModel.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('sets matchProvided', async () => {
      await service.update('badminton', { matchProvided: false });

      expect(sportTypeModel.updateOne).toHaveBeenCalledWith(
        { value: 'badminton' },
        { $set: { matchProvided: false } },
      );
    });

    it('replaces playerRoles, deduped', async () => {
      await service.update('football', {
        playerRoles: ['goalkeeper', 'forward', 'forward'],
      });

      expect(sportTypeModel.updateOne).toHaveBeenCalledWith(
        { value: 'football' },
        { $set: { playerRoles: ['goalkeeper', 'forward'] } },
      );
    });

    describe('rename via name', () => {
      beforeEach(() => {
        for (const m of [groupModel, eventModel, templateModel, userModel]) {
          m.updateMany = jest.fn();
        }
      });

      it('changes the name only — value (the ID) and holders stay put', async () => {
        await service.update('badminton', { name: 'Shuttle', sortOrder: 3 });

        expect(sportTypeModel.updateOne).toHaveBeenCalledWith(
          { value: 'badminton' },
          { $set: { sortOrder: 3, name: 'Shuttle' } },
        );
        for (const m of [groupModel, eventModel, templateModel, userModel]) {
          expect(m.updateMany).not.toHaveBeenCalled();
        }
      });

      it('checks the name case-insensitively against the other sports', async () => {
        await service.update('badminton', { name: 'Shuttle' });
        expect(sportTypeModel.exists).toHaveBeenCalledWith({
          name: { $regex: '^Shuttle$', $options: 'i' },
          value: { $ne: 'badminton' },
        });
      });

      it('409s a name another sport has, touching nothing', async () => {
        sportTypeModel.exists.mockResolvedValue({ _id: 'x' });
        await expect(
          service.update('badminton', { name: 'football' }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(sportTypeModel.updateOne).not.toHaveBeenCalled();
      });

      it('is a no-op when the name is unchanged', async () => {
        // Rows without a stored name read as their value.
        await service.update('badminton', { name: 'badminton' });
        expect(sportTypeModel.exists).not.toHaveBeenCalled();
        expect(sportTypeModel.updateOne).not.toHaveBeenCalled();
      });
    });
  });

  describe('remove', () => {
    it('deletes an unused sport', async () => {
      await expect(service.remove('badminton')).resolves.toEqual({
        deleted: true,
        value: 'badminton',
      });
      expect(sportTypeModel.deleteOne).toHaveBeenCalledWith({
        value: 'badminton',
      });
    });

    it('refuses while anything still stores the value, naming the holders', async () => {
      groupModel.countDocuments.mockResolvedValue(3);
      userModel.countDocuments.mockResolvedValue(1);
      await expect(service.remove('futsal')).rejects.toThrow(
        /'futsal' is still in use \(3 groups, 1 users\)/,
      );
      expect(sportTypeModel.deleteOne).not.toHaveBeenCalled();
    });

    describe('with replaceWith', () => {
      beforeEach(() => {
        for (const m of [groupModel, eventModel, templateModel, userModel]) {
          m.updateMany = jest.fn().mockResolvedValue({});
        }
        groupModel.countDocuments.mockResolvedValue(3);
        eventModel.countDocuments.mockResolvedValue(28);
      });

      it('moves futsal holders to football, then deletes', async () => {
        await expect(service.remove('futsal', 'football')).resolves.toEqual({
          deleted: true,
          value: 'futsal',
          replacedWith: 'football',
        });

        // football lists 'futsal' as a format, so moved events keep it there.
        for (const m of [eventModel, templateModel]) {
          expect(m.updateMany).toHaveBeenCalledWith(
            { sportType: 'futsal' },
            { $set: { sportType: 'football', subType: 'futsal' } },
          );
        }
        expect(groupModel.updateMany).toHaveBeenCalledWith(
          { sportType: 'futsal' },
          { $set: { sportType: 'football' } },
        );
        expect(userModel.updateMany).toHaveBeenCalledWith(
          { sports: { $all: ['futsal', 'football'] } },
          { $pull: { sports: 'futsal' } },
        );
        expect(userModel.updateMany).toHaveBeenCalledWith(
          { preferredSport: 'futsal' },
          { $set: { 'preferredSport.$': 'football' } },
        );
        expect(sportTypeModel.deleteOne).toHaveBeenCalledWith({
          value: 'futsal',
        });
      });

      it('clears subTypes the replacement does not list', async () => {
        await service.remove('football', 'badminton');
        expect(eventModel.updateMany).toHaveBeenCalledWith(
          { sportType: 'football', subType: { $nin: [null] } },
          { $set: { subType: null } },
        );
        expect(eventModel.updateMany).toHaveBeenCalledWith(
          { sportType: 'football' },
          { $set: { sportType: 'badminton' } },
        );
      });

      it.each([
        ['an unknown replacement', 'cricket'],
        ['itself', 'futsal'],
      ])('400s %s, touching nothing', async (_, replaceWith) => {
        await expect(
          service.remove('futsal', replaceWith),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(groupModel.updateMany).not.toHaveBeenCalled();
        expect(sportTypeModel.deleteOne).not.toHaveBeenCalled();
      });
    });
  });

  describe('addSubType / removeSubType', () => {
    it('adds a new format with $addToSet', async () => {
      await service.addSubType('football', 'beach');
      expect(sportTypeModel.updateOne).toHaveBeenCalledWith(
        { value: 'football' },
        { $addToSet: { subTypes: 'beach' } },
      );
    });

    it('409s a format the sport already lists', async () => {
      await expect(
        service.addSubType('football', 'futsal'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('removes an unused format with $pull', async () => {
      await service.removeSubType('football', 'Stadium');
      expect(sportTypeModel.updateOne).toHaveBeenCalledWith(
        { value: 'football' },
        { $pull: { subTypes: 'stadium' } },
      );
    });

    it('404s a format the sport does not list', async () => {
      await expect(
        service.removeSubType('badminton', 'doubles'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to remove a format a template still uses', async () => {
      templateModel.countDocuments.mockResolvedValue(1);
      await expect(service.removeSubType('football', 'futsal')).rejects.toThrow(
        /still in use \(1 templates\)/,
      );
      expect(sportTypeModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('reorderSubTypes', () => {
    it('stores the new order', async () => {
      await service.reorderSubTypes('football', ['stadium', 'futsal']);
      expect(sportTypeModel.updateOne).toHaveBeenCalledWith(
        { value: 'football' },
        { $set: { subTypes: ['stadium', 'futsal'] } },
      );
    });

    it.each([
      ['a missing subType', ['stadium']],
      ['an unknown subType', ['stadium', 'futsal', 'beach']],
      ['a duplicate', ['stadium', 'stadium']],
    ])('400s %s, touching nothing', async (_, order) => {
      await expect(
        service.reorderSubTypes('football', order),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sportTypeModel.updateOne).not.toHaveBeenCalled();
    });

    it('404s an unknown sport', async () => {
      await expect(
        service.reorderSubTypes('cricket', []),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('renameSubType', () => {
    beforeEach(() => {
      eventModel.updateMany = jest.fn().mockResolvedValue({});
      templateModel.updateMany = jest.fn().mockResolvedValue({});
    });

    it('renames in place and moves events and templates to the new name', async () => {
      await service.renameSubType('football', 'Stadium', 'eleven-a-side');

      const filter = { sportType: 'football', subType: 'stadium' };
      const $set = { subType: 'eleven-a-side' };
      expect(eventModel.updateMany).toHaveBeenCalledWith(filter, { $set });
      expect(templateModel.updateMany).toHaveBeenCalledWith(filter, { $set });
      expect(sportTypeModel.updateOne).toHaveBeenCalledWith(
        { value: 'football', subTypes: 'stadium' },
        { $set: { 'subTypes.$': 'eleven-a-side' } },
      );
    });

    it('404s a format the sport does not list', async () => {
      await expect(
        service.renameSubType('badminton', 'doubles', 'pairs'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s a new name the sport already lists, touching nothing', async () => {
      await expect(
        service.renameSubType('football', 'stadium', 'futsal'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(eventModel.updateMany).not.toHaveBeenCalled();
      expect(sportTypeModel.updateOne).not.toHaveBeenCalled();
    });

    it('is a no-op when the name is unchanged', async () => {
      await service.renameSubType('football', 'stadium', 'stadium');
      expect(eventModel.updateMany).not.toHaveBeenCalled();
      expect(sportTypeModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
