import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

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
    getQr: jest.fn().mockResolvedValue({ inviteCode: 'c', inviteLink: 'l' }),
    listLocations: jest.fn().mockResolvedValue([]),
    attachLocation: jest.fn().mockResolvedValue({ _id: 'g1' }),
    detachLocation: jest.fn().mockResolvedValue({ _id: 'g1' }),
    listMembers: jest.fn().mockResolvedValue([]),
    removeMember: jest.fn().mockResolvedValue({ message: 'Member removed' }),
    leave: jest.fn().mockResolvedValue({ message: 'You have left the group' }),
    updateMemberRole: jest.fn().mockResolvedValue({ role: 'admin' }),
    generateInviteCode: jest.fn().mockResolvedValue('code-1'),
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

  describe('search', () => {
    it('GET /groups/search delegates the query', async () => {
      await controller.search('lumpini');
      expect(svc.search).toHaveBeenCalledWith('lumpini');
    });

    it('coerces a missing query to an empty string', async () => {
      await controller.search(undefined as any);
      expect(svc.search).toHaveBeenCalledWith('');
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

    it('GET /groups/:id passes the caller so the response can carry userRole', async () => {
      await controller.findOne('g1', user);
      expect(svc.findById).toHaveBeenCalledWith('g1', 'requester-1');
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

    it('GET /groups/:id/members', async () => {
      await controller.listMembers('g1');
      expect(svc.listMembers).toHaveBeenCalledWith('g1');
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

  describe('route ordering', () => {
    it("declares the literal 'search' route before the ':id' wildcard", () => {
      const src = require('fs').readFileSync(
        __dirname + '/groups.controller.ts',
        'utf8',
      );
      const searchAt = src.indexOf("@Get('search')");
      const idAt = src.indexOf("@Get(':id')");
      expect(searchAt).toBeGreaterThan(-1);
      expect(idAt).toBeGreaterThan(-1);
      expect(searchAt).toBeLessThan(idAt);
    });
  });
});
