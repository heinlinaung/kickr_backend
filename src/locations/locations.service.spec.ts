import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { LocationsService } from './locations.service';
import { Location } from './schemas/location.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { Group } from '../groups/schemas/group.schema';

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

  const memberModel: any = { findOne: jest.fn() };
  const groupModel: any = { updateMany: jest.fn().mockResolvedValue({}) };

  const OWNER = new Types.ObjectId().toString();
  const OTHER = new Types.ObjectId().toString();
  const LOC_ID = new Types.ObjectId().toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    memberModel.findOne.mockResolvedValue(null);
    groupModel.updateMany.mockResolvedValue({});
    const m = await Test.createTestingModule({
      providers: [
        LocationsService,
        { provide: getModelToken(Location.name), useValue: locationModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
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

      await service.create(OWNER, dto);

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

      const first = await service.create(OWNER, dto);
      const second = await service.create(OTHER, dto);

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
      });

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
      await expect(service.assertOwnedBy(LOC_ID, OWNER)).resolves.toBeDefined();
    });

    it('throws ForbiddenException when another user owns the location', async () => {
      locationModel.findById.mockResolvedValue({
        _id: LOC_ID,
        createdBy: new Types.ObjectId(OWNER),
      });
      await expect(service.assertOwnedBy(LOC_ID, OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ------------------------------------------------- group-owned locations (Option A)
  describe('group-owned location permissions', () => {
    const GROUP_ID = new Types.ObjectId().toString();

    /** a location owned by GROUP_ID, created by OWNER */
    const groupLocation = () => ({
      _id: LOC_ID,
      name: 'Club Ground',
      lat: 1,
      lng: 2,
      createdBy: { toString: () => OWNER },
      groupId: { toString: () => GROUP_ID },
      save: jest.fn().mockResolvedValue({ _id: LOC_ID, name: 'Updated' }),
    });

    /** a personal location created by OWNER */
    const personalLocation = () => ({
      _id: LOC_ID,
      name: 'My Pitch',
      lat: 1,
      lng: 2,
      createdBy: { toString: () => OWNER },
      groupId: null,
      save: jest.fn().mockResolvedValue({ _id: LOC_ID }),
    });

    /**
     * Simulates Mongo: only returns the membership when the caller's role is
     * within the `role: { $in: [...] }` filter the service applies. Without
     * this the mock would grant every role, hiding permission bugs.
     */
    const asRole = (role: string) =>
      memberModel.findOne.mockImplementation((filter: any) => {
        const allowed = filter?.role?.$in ?? [];
        return Promise.resolve(
          allowed.includes(role) ? { role, status: 'approved' } : null,
        );
      });

    it('lets a group CAPTAIN edit a group-owned location they did not create', async () => {
      locationModel.findById.mockResolvedValue(groupLocation());
      asRole('captain');

      await expect(
        service.update(LOC_ID, OTHER, { name: 'Updated' }),
      ).resolves.toBeDefined();
    });

    it('lets a group VICE-CAPTAIN edit a group-owned location', async () => {
      // vice-captain mirrors captain for edits by decision.
      locationModel.findById.mockResolvedValue(groupLocation());
      asRole('vice-captain');

      await expect(
        service.update(LOC_ID, OTHER, { name: 'Updated' }),
      ).resolves.toBeDefined();
    });

    it('lets a group ADMIN edit a group-owned location', async () => {
      locationModel.findById.mockResolvedValue(groupLocation());
      asRole('admin');
      await expect(
        service.update(LOC_ID, OTHER, { name: 'Updated' }),
      ).resolves.toBeDefined();
    });

    it('rejects a plain MEMBER editing a group-owned location', async () => {
      locationModel.findById.mockResolvedValue(groupLocation());
      asRole('member');
      await expect(
        service.update(LOC_ID, OTHER, { name: 'Nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a non-member editing a group-owned location', async () => {
      locationModel.findById.mockResolvedValue(groupLocation());
      memberModel.findOne.mockResolvedValue(null);
      groupModel.updateMany.mockResolvedValue({});
      await expect(
        service.update(LOC_ID, OTHER, { name: 'Nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('still lets the creator edit their own group-owned location', async () => {
      locationModel.findById.mockResolvedValue(groupLocation());
      memberModel.findOne.mockResolvedValue(null);
      groupModel.updateMany.mockResolvedValue({}); // not even a member
      await expect(
        service.update(LOC_ID, OWNER, { name: 'Updated' }),
      ).resolves.toBeDefined();
    });

    it('does NOT let a captain of some group edit a PERSONAL location', async () => {
      locationModel.findById.mockResolvedValue(personalLocation());
      asRole('captain');
      await expect(
        service.update(LOC_ID, OTHER, { name: 'Nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // membership must not even be consulted for a personal location
      expect(memberModel.findOne).not.toHaveBeenCalled();
    });

    it('captain may EDIT but NOT DELETE a group-owned location', async () => {
      locationModel.findById.mockResolvedValue(groupLocation());
      asRole('captain');
      await expect(service.remove(LOC_ID, OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('vice-captain may EDIT but NOT DELETE a group-owned location', async () => {
      // Deleting a venue the group relies on is structural, so it stays with
      // owner/admin — vice-captain inherits captain's limit too.
      locationModel.findById.mockResolvedValue(groupLocation());
      asRole('vice-captain');
      await expect(service.remove(LOC_ID, OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('admin MAY delete a group-owned location', async () => {
      locationModel.findById.mockResolvedValue(groupLocation());
      asRole('admin');
      locationModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await expect(service.remove(LOC_ID, OTHER)).resolves.toEqual(
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('only considers APPROVED memberships', async () => {
      locationModel.findById.mockResolvedValue(groupLocation());
      asRole('captain');
      await service.update(LOC_ID, OTHER, { name: 'Updated' });
      expect(memberModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' }),
      );
    });
  });

  describe('remove cleans up group references', () => {
    it('pulls the deleted id out of every group that referenced it', async () => {
      locationModel.findById.mockResolvedValue({
        _id: LOC_ID,
        createdBy: { toString: () => OWNER },
        groupId: null,
      });
      locationModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await service.remove(LOC_ID, OWNER);

      // otherwise a stale id lingers in Group.locations — invisible in the
      // populated list but still counting toward the 5-location cap
      expect(groupModel.updateMany).toHaveBeenCalledTimes(1);
      const [filter, update] = groupModel.updateMany.mock.calls[0];
      expect(filter.locations.toString()).toBe(LOC_ID);
      expect(update.$pull.locations.toString()).toBe(LOC_ID);
    });
  });

  describe('create with groupId (client-supplied owning group)', () => {
    const GROUP_ID = new Types.ObjectId().toString();

    it('rejects when the caller is not an owner/admin of that group', async () => {
      memberModel.findOne.mockResolvedValue(null); // not a manager
      await expect(
        service.create(OWNER, {
          name: 'Club Ground',
          lat: 1,
          lng: 2,
          groupId: GROUP_ID,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(locationModel.create).not.toHaveBeenCalled();
    });

    it('rejects a CAPTAIN creating a group-owned location (owner/admin only)', async () => {
      memberModel.findOne.mockImplementation((f: any) =>
        Promise.resolve(
          (f?.role?.$in ?? []).includes('captain') ? { role: 'captain' } : null,
        ),
      );
      await expect(
        service.create(OWNER, {
          name: 'X',
          lat: 1,
          lng: 2,
          groupId: GROUP_ID,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stores groupId when the caller is an admin of that group', async () => {
      memberModel.findOne.mockResolvedValue({ role: 'admin' });
      locationModel.create.mockResolvedValue({ _id: LOC_ID });

      await service.create(OWNER, {
        name: 'Club Ground',
        lat: 1,
        lng: 2,
        groupId: GROUP_ID,
      });

      const arg = locationModel.create.mock.calls[0][0];
      expect(arg.groupId.toString()).toBe(GROUP_ID);
      // the raw string must not leak through the spread
      expect(typeof arg.groupId).not.toBe('string');
    });

    it('creates a personal location (groupId null) when omitted, with no membership check', async () => {
      locationModel.create.mockResolvedValue({ _id: LOC_ID });
      await service.create(OWNER, { name: 'Mine', lat: 1, lng: 2 });
      expect(memberModel.findOne).not.toHaveBeenCalled();
      expect(locationModel.create.mock.calls[0][0].groupId).toBeNull();
    });
  });

  describe('adoptPersonalLocations', () => {
    it('only adopts rows that are still personal AND created by the caller', async () => {
      locationModel.updateMany = jest.fn().mockResolvedValue({});
      const gid = new Types.ObjectId().toString();
      const ids = [new Types.ObjectId()];

      await service.adoptPersonalLocations(ids, OWNER, gid);

      const [filter, update] = locationModel.updateMany.mock.calls[0];
      // never steal a location owned by someone else or by another group
      expect(filter.groupId).toBeNull(); // matches null AND missing in Mongo
      expect(filter.createdBy.toString()).toBe(OWNER);
      expect(update.$set.groupId.toString()).toBe(gid);
    });

    it('SKIPS a location that already belongs to a group (never reassigns)', async () => {
      locationModel.updateMany = jest
        .fn()
        .mockResolvedValue({ modifiedCount: 0 });
      const otherGroup = new Types.ObjectId().toString();
      await service.adoptPersonalLocations(
        [new Types.ObjectId()],
        OWNER,
        otherGroup,
      );
      // the filter must exclude already-owned rows, so Mongo matches nothing
      const [filter] = locationModel.updateMany.mock.calls[0];
      expect(filter.groupId).toBeNull(); // matches null AND missing in Mongo
      // a doc with groupId set simply won't match this filter
      const alreadyOwned = { groupId: new Types.ObjectId() };
      const matchesUnclaimed =
        alreadyOwned.groupId === null || alreadyOwned.groupId === undefined;
      expect(matchesUnclaimed).toBe(false);
    });
    it('is a no-op for an empty list', async () => {
      locationModel.updateMany = jest.fn();
      await service.adoptPersonalLocations(
        [],
        OWNER,
        new Types.ObjectId().toString(),
      );
      expect(locationModel.updateMany).not.toHaveBeenCalled();
    });
  });
});
