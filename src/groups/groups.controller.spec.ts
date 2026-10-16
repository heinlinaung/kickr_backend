import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { PublicGroupsController } from './public-groups.controller';
import { GroupsService } from './groups.service';
import { SuperadminGuard } from '../common/guards/superadmin.guard';

describe('GroupsController', () => {
  let controller: GroupsController;

  const svc = {
    getMyGroups: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ _id: 'g1' }),
    findById: jest.fn().mockResolvedValue({ _id: 'g1' }),
    update: jest.fn().mockResolvedValue({ _id: 'g1' }),
    updateWallpaper: jest.fn().mockResolvedValue({ _id: 'g1' }),
    updateLogo: jest.fn().mockResolvedValue({ _id: 'g1' }),
    search: jest.fn().mockResolvedValue([]),
    listAll: jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    }),
    getQr: jest.fn().mockResolvedValue({ inviteCode: 'c', inviteLink: 'l' }),
    listLocations: jest.fn().mockResolvedValue([]),
    attachLocation: jest.fn().mockResolvedValue({ _id: 'g1' }),
    detachLocation: jest.fn().mockResolvedValue({ _id: 'g1' }),
    listMembers: jest.fn().mockResolvedValue([]),
    removeMember: jest.fn().mockResolvedValue({ message: 'Member removed' }),
    leave: jest.fn().mockResolvedValue({ message: 'You have left the group' }),
    updateMemberRole: jest.fn().mockResolvedValue({ role: 'admin' }),
    generateInviteCode: jest.fn().mockResolvedValue('code-1'),
    remove: jest
      .fn()
      .mockResolvedValue({ message: 'Group deleted successfully' }),
  };

  const user = { _id: 'requester-1' } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [GroupsController],
      providers: [{ provide: GroupsService, useValue: svc }],
    }).compile();
    controller = m.get(GroupsController);
  });

  describe('listAll', () => {
    it('GET /groups/group-all is superadmin only', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        GroupsController.prototype.listAll,
      );
      expect(guards).toContain(SuperadminGuard);
    });

    it('passes q, page and limit through', async () => {
      await controller.listAll('fc', '3', '5');
      expect(svc.listAll).toHaveBeenCalledWith('fc', 3, 5);

      await controller.listAll();
      expect(svc.listAll).toHaveBeenLastCalledWith(
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('search', () => {
    // The caller rides along so each card can carry joinedByMe/memberStatus.
    const CALLER = { _id: 'u1' };

    it('GET /groups/search delegates the query and the caller', async () => {
      await controller.search(CALLER, 'lumpini');
      // limit/cursor pass through as undefined when absent, so the service's
      // own defaults apply rather than the controller inventing them.
      expect(svc.search).toHaveBeenCalledWith(
        'lumpini',
        undefined,
        undefined,
        'u1',
      );
    });

    it('coerces a missing query to an empty string', async () => {
      await controller.search(CALLER, undefined as any);
      expect(svc.search).toHaveBeenCalledWith('', undefined, undefined, 'u1');
    });

    it('passes limit and cursor through', async () => {
      await controller.search(CALLER, 'lumpini', '5', 'eyJpIjoiYWJjIn0');

      expect(svc.search).toHaveBeenCalledWith(
        'lumpini',
        5,
        'eyJpIjoiYWJjIn0',
        'u1',
      );
    });

    it('hands a non-numeric limit to the service as NaN', async () => {
      // clampLimit owns the NaN guard; the controller must not pre-empt it with
      // a second, divergent clamp.
      await controller.search(CALLER, 'x', 'abc');

      const limit = svc.search.mock.calls[0][1];
      expect(Number.isNaN(limit)).toBe(true);
    });
  });

  describe('images', () => {
    const file = { buffer: Buffer.from('x'), mimetype: 'image/png' } as any;

    it('wallpaper passes the file object (not a filename)', async () => {
      await controller.uploadWallpaper('g1', user, file);
      expect(svc.updateWallpaper).toHaveBeenCalledWith(
        'g1',
        'requester-1',
        file,
      );
    });

    it('wallpaper throws when no file is present', () => {
      expect(() =>
        controller.uploadWallpaper('g1', user, undefined as any),
      ).toThrow(BadRequestException);
      expect(svc.updateWallpaper).not.toHaveBeenCalled();
    });

    it('logo passes the file object', async () => {
      await controller.uploadLogo('g1', user, file);
      expect(svc.updateLogo).toHaveBeenCalledWith('g1', 'requester-1', file);
    });

    it('logo throws when no file is present', () => {
      expect(() => controller.uploadLogo('g1', user, undefined as any)).toThrow(
        BadRequestException,
      );
      expect(svc.updateLogo).not.toHaveBeenCalled();
    });
  });

  it('GET /groups/:id/qr delegates without the caller id (no role check)', async () => {
    await controller.getQr('g1');
    expect(svc.getQr).toHaveBeenCalledWith('g1');
  });

  describe('locations', () => {
    it('GET delegates', async () => {
      await controller.listLocations('g1');
      expect(svc.listLocations).toHaveBeenCalledWith('g1');
    });

    it('POST delegates the dto', async () => {
      const dto = { locationId: 'loc1' };
      await controller.attachLocation('g1', user, dto);
      expect(svc.attachLocation).toHaveBeenCalledWith('g1', 'requester-1', dto);
    });

    it('DELETE delegates the location id', async () => {
      await controller.detachLocation('g1', 'loc1', user);
      expect(svc.detachLocation).toHaveBeenCalledWith(
        'g1',
        'requester-1',
        'loc1',
      );
    });
  });

  describe('updateMemberRole', () => {
    it('passes the requester before the target user', async () => {
      const dto = { role: 'admin' };
      await controller.updateMemberRole('g1', 'target-9', user, dto);
      expect(svc.updateMemberRole).toHaveBeenCalledWith(
        'g1',
        'requester-1',
        'target-9',
        dto,
      );
    });
  });

  describe('existing routes still work', () => {
    it('GET /groups', async () => {
      await controller.getMyGroups(user);
      expect(svc.getMyGroups).toHaveBeenCalledWith('requester-1');
    });

    it('POST /groups', async () => {
      const dto = { name: 'Squad' } as any;
      await controller.create(user, dto);
      expect(svc.create).toHaveBeenCalledWith('requester-1', dto);
    });

    it('GET /groups/:id (public controller) passes the caller when present', async () => {
      // The detail moved to PublicGroupsController (optional auth).
      const pub = new PublicGroupsController(svc as any);
      await pub.findOne('g1', user);
      expect(svc.findById).toHaveBeenCalledWith('g1', 'requester-1');
    });

    it('GET /groups/:id serves an ANONYMOUS caller with no user id', async () => {
      const pub = new PublicGroupsController(svc as any);
      await pub.findOne('g1', null);
      expect(svc.findById).toHaveBeenCalledWith('g1', undefined);
    });

    it('PATCH /groups/:id', async () => {
      const dto = { name: 'New' } as any;
      await controller.update('g1', user, dto);
      expect(svc.update).toHaveBeenCalledWith('g1', 'requester-1', dto);
    });

    it('POST /groups/:id/leave passes only the caller (no target id)', async () => {
      await controller.leave('g1', user);
      expect(svc.leave).toHaveBeenCalledWith('g1', 'requester-1');
    });

    it('GET /groups/:id/members passes the caller for the privacy gate', async () => {
      // The service needs the caller to decide whether a private group's
      // member list is visible; forgetting it would throw on user._id.
      await controller.listMembers('g1', user);
      expect(svc.listMembers).toHaveBeenCalledWith('g1', 'requester-1');
    });

    it('DELETE /groups/:id/members/:userId passes requester then target', async () => {
      await controller.removeMember('g1', 'target-9', user);
      expect(svc.removeMember).toHaveBeenCalledWith(
        'g1',
        'requester-1',
        'target-9',
      );
    });

    it('GET /groups/:id/invite-code wraps the code', async () => {
      const res = await controller.getInviteCode('g1', user);
      expect(svc.generateInviteCode).toHaveBeenCalledWith('g1', 'requester-1');
      expect(res).toEqual({ inviteCode: 'code-1' });
    });
  });

  describe('remove', () => {
    it('DELETE /groups/:id passes the group then the caller', async () => {
      await controller.remove('g1', user);
      expect(svc.remove).toHaveBeenCalledWith('g1', 'requester-1');
    });

    it('is declared as a bare :id DELETE, not under a sub-path', async () => {
      const src: string = require('fs').readFileSync(
        __dirname + '/groups.controller.ts',
        'utf8',
      );
      expect(src).toContain("@Delete(':id')");
      // Must not collide with the two existing sub-path deletes.
      expect(src).toContain("@Delete(':id/locations/:locationId')");
      expect(src).toContain("@Delete(':id/members/:userId')");
    });
  });

  describe('route ordering', () => {
    it("the ':id' wildcard lives in the PUBLIC controller, registered last", () => {
      // GET /groups/:id moved to PublicGroupsController (optional auth). The
      // bare ':id' must not exist in the guarded controller any more…
      const fs = require('fs');
      const guarded = fs.readFileSync(
        __dirname + '/groups.controller.ts',
        'utf8',
      );
      expect(guarded.indexOf("@Get('search')")).toBeGreaterThan(-1);
      expect(guarded.indexOf("@Get(':id')")).toBe(-1);

      // …and the public controller that owns it must be registered AFTER the
      // guarded one, or its ':id' would swallow /groups/search.
      const pub = fs.readFileSync(
        __dirname + '/public-groups.controller.ts',
        'utf8',
      );
      expect(pub.indexOf("@Get(':id')")).toBeGreaterThan(-1);

      const moduleSrc = fs.readFileSync(
        __dirname + '/groups.module.ts',
        'utf8',
      );
      const controllersAt = moduleSrc.indexOf('controllers:');
      const guardedAt = moduleSrc.indexOf('GroupsController', controllersAt);
      const publicAt = moduleSrc.indexOf(
        'PublicGroupsController',
        controllersAt,
      );
      expect(guardedAt).toBeGreaterThan(-1);
      expect(publicAt).toBeGreaterThan(guardedAt);
    });
  });
});
