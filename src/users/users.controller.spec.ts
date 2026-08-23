// src/users/users.controller.spec.ts
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  const svc = {
    findById: jest.fn().mockResolvedValue({ _id: 'u1' }),
    updateProfile: jest.fn().mockResolvedValue({ _id: 'u1' }),
    updateAvatar: jest.fn().mockResolvedValue({ _id: 'u1' }),
    getQr: jest.fn().mockResolvedValue({ inviteCode: 'c', inviteLink: 'l' }),
    search: jest.fn().mockResolvedValue([]),
    getPublicProfile: jest.fn().mockResolvedValue({ _id: 'u2' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: svc }],
    }).compile();
    controller = m.get(UsersController);
  });

  describe('profile routes', () => {
    it('GET me/qr delegates', async () => {
      await controller.getQr({ _id: 'u1' } as any);
      expect(svc.getQr).toHaveBeenCalledWith('u1');
    });

    it('GET :id/profile delegates', async () => {
      await controller.getPublicProfile('u2');
      expect(svc.getPublicProfile).toHaveBeenCalledWith('u2');
    });
  });

  describe('search', () => {
    it('GET /users/search delegates the query', async () => {
      await controller.search('hein');
      expect(svc.search).toHaveBeenCalledWith('hein', undefined, undefined);
    });

    it('coerces a missing query to an empty string', async () => {
      // The service returns [] for an empty term rather than dumping rows.
      await controller.search(undefined);
      expect(svc.search).toHaveBeenCalledWith('', undefined, undefined);
    });

    it('passes a numeric limit through as a number', async () => {
      await controller.search('hein', '35');
      expect(svc.search).toHaveBeenCalledWith('hein', 35, undefined);
    });

    it('leaves the limit undefined when absent, so the service default wins', async () => {
      await controller.search('hein', undefined);
      expect(svc.search).toHaveBeenCalledWith('hein', undefined, undefined);
    });

    it('forwards the cursor verbatim', async () => {
      // Opaque to the controller — it must not parse or validate it.
      await controller.search('hein', undefined, 'eyJpIjoiYWJjIn0');
      expect(svc.search).toHaveBeenCalledWith(
        'hein',
        undefined,
        'eyJpIjoiYWJjIn0',
      );
    });

    it('forwards a non-numeric limit as NaN for the service to reject', async () => {
      // The controller does not validate; clampLimit() owns that decision so
      // the rule lives in one place. Guards against the NaN reaching Mongoose.
      await controller.search('hein', 'abc');
      const [, limit] = svc.search.mock.calls[0];
      expect(Number.isNaN(limit)).toBe(true);
    });
  });

  describe('route ordering', () => {
    /**
     * Line numbers of real @Get decorators, ignoring doc comments.
     *
     * A raw indexOf would be fooled by the comment above `search`, which
     * quotes "@Get(':id/profile')" in prose — that mention appears in the file
     * BEFORE the actual decorator it warns about.
     */
    const getRoutes = (): { path: string; line: number }[] => {
      const src: string = require('fs').readFileSync(
        __dirname + '/users.controller.ts',
        'utf8',
      );
      const routes: { path: string; line: number }[] = [];
      src.split('\n').forEach((raw, i) => {
        const text = raw.trim();
        if (text.startsWith('*') || text.startsWith('//')) return;
        const m = text.match(/^@Get\((?:'([^']*)')?\)/);
        if (m) routes.push({ path: m[1] ?? '', line: i + 1 });
      });
      return routes;
    };

    it("declares the literal 'search' route before any ':id' wildcard", () => {
      // Nest matches in declaration order: a ':id' route declared first would
      // swallow /users/search and 404 it.
      const routes = getRoutes();
      const search = routes.find((r) => r.path === 'search');
      const wildcards = routes.filter((r) => r.path.startsWith(':'));

      expect(search).toBeDefined();
      expect(wildcards.length).toBeGreaterThan(0);
      for (const w of wildcards) {
        expect(search!.line).toBeLessThan(w.line);
      }
    });
  });
});
