// src/events/events.controller.search.spec.ts
//
// Scoped to the search endpoint: EventsController is large, so mocking it
// wholesale would couple this spec to every unrelated route. Only `search` is
// exercised here.
import { Test } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

describe('EventsController — search', () => {
  let controller: EventsController;

  const svc = { search: jest.fn().mockResolvedValue([]) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventsService, useValue: svc }],
    }).compile();
    controller = m.get(EventsController);
  });

  it('GET /events/search delegates the query', async () => {
    await controller.searchEvents('friday night');
    expect(svc.search).toHaveBeenCalledWith('friday night', false, undefined, undefined);
  });

  it('coerces a missing query to an empty string', async () => {
    await controller.searchEvents(undefined);
    expect(svc.search).toHaveBeenCalledWith('', false, undefined, undefined);
  });

  describe('includeExpired', () => {
    it("is true only for the exact string 'true'", async () => {
      await controller.searchEvents('friday', 'true');
      expect(svc.search).toHaveBeenCalledWith('friday', true, undefined, undefined);
    });

    it('defaults to false when absent', async () => {
      await controller.searchEvents('friday', undefined);
      expect(svc.search).toHaveBeenCalledWith('friday', false, undefined, undefined);
    });

    it('is false for any other value, so a typo never widens visibility', async () => {
      // '1', 'yes', 'TRUE' must not silently unhide past/done events.
      for (const v of ['1', 'yes', 'TRUE', '']) {
        jest.clearAllMocks();
        await controller.searchEvents('friday', v);
        expect(svc.search).toHaveBeenCalledWith('friday', false, undefined, undefined);
      }
    });
  });

  describe('limit', () => {
    it('passes a numeric limit through as a number', async () => {
      await controller.searchEvents('friday', undefined, '35');
      expect(svc.search).toHaveBeenCalledWith('friday', false, 35, undefined);
    });

    it('stays undefined when absent, so the service default wins', async () => {
      await controller.searchEvents('friday', undefined, undefined);
      expect(svc.search).toHaveBeenCalledWith('friday', false, undefined, undefined);
    });

    it('forwards the cursor verbatim', async () => {
      // Opaque to the controller — it must not parse or validate it.
      await controller.searchEvents(
        'friday',
        undefined,
        undefined,
        'eyJpIjoiYWJjIn0',
      );
      expect(svc.search).toHaveBeenCalledWith(
        'friday',
        false,
        undefined,
        'eyJpIjoiYWJjIn0',
      );
    });

    it('forwards a non-numeric limit as NaN for the service to reject', async () => {
      // clampLimit() owns the validation so the rule lives in one place.
      await controller.searchEvents('friday', undefined, 'abc');
      const [, , limit] = svc.search.mock.calls[0];
      expect(Number.isNaN(limit)).toBe(true);
    });
  });

  describe('route ordering', () => {
    /**
     * Line numbers of real @Get decorators, ignoring doc comments.
     *
     * A raw indexOf would be fooled by the comments above `search`, `joined`
     * and `group/:groupId`, which all quote "@Get(':id')" in prose — those
     * mentions appear in the file BEFORE the actual decorator.
     */
    const getRoutes = (): { path: string; line: number }[] => {
      const src: string = require('fs').readFileSync(
        __dirname + '/events.controller.ts',
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
      // Nest matches in declaration order: ':id' first would swallow
      // /events/search and 404 it.
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
