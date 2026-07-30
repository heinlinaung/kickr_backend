import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { LocationsService } from './locations.service';
import { Location } from './schemas/location.schema';

describe('LocationsService', () => {
  let service: LocationsService;

  const locationModel: any = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  };

  const OWNER = new Types.ObjectId().toString();
  const OTHER = new Types.ObjectId().toString();
  const LOC_ID = new Types.ObjectId().toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        LocationsService,
        { provide: getModelToken(Location.name), useValue: locationModel },
      ],
    }).compile();
    service = m.get(LocationsService);
  });

  describe('create', () => {
    it('always inserts a new row with createdBy derived from userId, with no dedupe lookup', async () => {
      const dto = {
        name: 'Lumpini Pitch',
        lat: 13.7563,
        lng: 100.5018,
        url: 'https://maps.example.com/x',
        metadata: { surface: 'grass' },
      };
      locationModel.create.mockResolvedValue({ _id: LOC_ID, ...dto });

      await service.create(OWNER, dto as any);

      expect(locationModel.create).toHaveBeenCalledTimes(1);
      const arg = locationModel.create.mock.calls[0][0];
      expect(arg).toEqual(
        expect.objectContaining({
          name: 'Lumpini Pitch',
          lat: 13.7563,
          lng: 100.5018,
          url: 'https://maps.example.com/x',
          metadata: { surface: 'grass' },
        }),
      );
      expect(arg.createdBy.toString()).toBe(OWNER);
      // geo is derived by the schema hook, never stamped by the service
      expect(arg.geo).toBeUndefined();
      // NO DEDUPE: creating must not consult existing rows in any way
      expect(locationModel.findOne).not.toHaveBeenCalled();
      expect(locationModel.find).not.toHaveBeenCalled();
    });

    it('inserts a second row for an identical name/coords instead of reusing the first', async () => {
      const dto = { name: 'Same Pitch', lat: 1, lng: 2 };
      locationModel.create
        .mockResolvedValueOnce({ _id: 'a', ...dto })
        .mockResolvedValueOnce({ _id: 'b', ...dto });

      const first = await service.create(OWNER, dto as any);
      const second = await service.create(OTHER, dto as any);

      expect(locationModel.create).toHaveBeenCalledTimes(2);
      expect((first as any)._id).toBe('a');
      expect((second as any)._id).toBe('b');
    });
  });

  describe('listMine', () => {
    it('filters by createdBy and sorts newest first', async () => {
      const lean = jest.fn().mockResolvedValue([{ _id: LOC_ID }]);
      const sort = jest.fn().mockReturnValue({ lean });
      locationModel.find.mockReturnValue({ sort });

      const res = await service.listMine(OWNER);

      const filter = locationModel.find.mock.calls[0][0];
      expect(filter.createdBy.toString()).toBe(OWNER);
      expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(res).toEqual([{ _id: LOC_ID }]);
    });
  });

  describe('update', () => {
    it('throws ForbiddenException when the caller does not own the doc', async () => {
      const doc = {
        _id: LOC_ID,
        createdBy: new Types.ObjectId(OWNER),
        save: jest.fn(),
      };
      locationModel.findById.mockResolvedValue(doc);

      await expect(
        service.update(LOC_ID, OTHER, { name: 'Hijacked' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the doc is missing', async () => {
      locationModel.findById.mockResolvedValue(null);
      await expect(
        service.update(LOC_ID, OWNER, { name: 'Nope' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('applies changes via load-then-save for the owner so the geo hook re-derives on lat/lng change', async () => {
      const doc: any = {
        _id: LOC_ID,
        name: 'Old',
        lat: 1,
        lng: 2,
        createdBy: new Types.ObjectId(OWNER),
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(doc);
        }),
      };
      locationModel.findById.mockResolvedValue(doc);

      const res = await service.update(LOC_ID, OWNER, {
        name: 'New',
        lat: 51.5,
        lng: -0.12,
      } as any);

      // the new values must be assigned onto the loaded doc...
      expect(doc.name).toBe('New');
      expect(doc.lat).toBe(51.5);
      expect(doc.lng).toBe(-0.12);
      // ...and persisted with .save() so pre('validate') refreshes geo.
      // findByIdAndUpdate would bypass the hook and let geo drift.
      expect(doc.save).toHaveBeenCalledTimes(1);
      expect(locationModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(res).toBe(doc);
    });

    it('never lets a caller overwrite createdBy through the update payload', async () => {
      const doc: any = {
        _id: LOC_ID,
        createdBy: new Types.ObjectId(OWNER),
        save: jest.fn().mockImplementation(() => Promise.resolve(doc)),
      };
      locationModel.findById.mockResolvedValue(doc);

      await service.update(LOC_ID, OWNER, {
        name: 'Renamed',
        createdBy: OTHER,
      } as any);

      expect(doc.createdBy.toString()).toBe(OWNER);
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when missing', async () => {
      locationModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      await expect(service.findById(LOC_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the row when present', async () => {
      locationModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: LOC_ID, name: 'Pitch' }),
      });
      const res = await service.findById(LOC_ID);
      expect((res as any).name).toBe('Pitch');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the row is missing', async () => {
      locationModel.findById.mockResolvedValue(null);
      await expect(service.remove(LOC_ID, OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(locationModel.deleteOne).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a non-owner and does not delete', async () => {
      locationModel.findById.mockResolvedValue({
        _id: LOC_ID,
        createdBy: new Types.ObjectId(OWNER),
      });
      await expect(service.remove(LOC_ID, OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(locationModel.deleteOne).not.toHaveBeenCalled();
    });

    it('deletes the row for the owner', async () => {
      locationModel.findById.mockResolvedValue({
        _id: LOC_ID,
        createdBy: new Types.ObjectId(OWNER),
      });
      locationModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await service.remove(LOC_ID, OWNER);

      expect(locationModel.deleteOne).toHaveBeenCalledWith({ _id: LOC_ID });
    });
  });

  describe('assertOwnedBy', () => {
    it('resolves for the owner', async () => {
      locationModel.findById.mockResolvedValue({
        _id: LOC_ID,
        createdBy: new Types.ObjectId(OWNER),
      });
      await expect(
        service.assertOwnedBy(LOC_ID, OWNER),
      ).resolves.toBeDefined();
    });

    it('throws ForbiddenException when another user owns the location', async () => {
      locationModel.findById.mockResolvedValue({
        _id: LOC_ID,
        createdBy: new Types.ObjectId(OWNER),
      });
      await expect(
        service.assertOwnedBy(LOC_ID, OTHER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
