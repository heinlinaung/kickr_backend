// src/events/events.controller.list.spec.ts
import { Test } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/**
 * Query parsing for `GET /events`, and `includeExpired` in particular.
 *
 * Worth its own spec because the flag's default here is TRUE while every other
 * route defaults it to FALSE. Those routes use `includeExpired === 'true'`,
 * which reads an absent param as false — correct for them, and silently WRONG
 * here: it would hide expired events for every caller who did not pass the
 * parameter, inverting the default.
 */
describe('EventsController — GET /events query parsing', () => {
  let controller: EventsController;
  const svc: any = {};

  const caller = { _id: { toString: () => 'u1' } };

  /** The options object the controller hands the service. */
  const optionsFrom = () => svc.list.mock.calls.at(-1)[1];

  beforeEach(async () => {
    jest.clearAllMocks();
    svc.list = jest.fn().mockResolvedValue([]);

    const m = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventsService, useValue: svc }],
    }).compile();
    controller = m.get(EventsController);
  });

  describe('includeExpired', () => {
    it('defaults to TRUE when the parameter is absent', async () => {
      await controller.list(caller);

      expect(optionsFrom().includeExpired).toBe(true);
    });

    it('is false for ?includeExpired=false', async () => {
      await controller.list(caller, undefined, undefined, undefined, undefined, undefined, undefined, 'false');

      expect(optionsFrom().includeExpired).toBe(false);
    });

    it('is true for ?includeExpired=true', async () => {
      await controller.list(caller, undefined, undefined, undefined, undefined, undefined, undefined, 'true');

      expect(optionsFrom().includeExpired).toBe(true);
    });

    it('treats any other value as true, matching the default', async () => {
      // Only the explicit string 'false' opts out. A typo must not silently
      // hide rows — the safer direction for a discovery list is to show more,
      // not less.
      await controller.list(caller, undefined, undefined, undefined, undefined, undefined, undefined, 'nope');

      expect(optionsFrom().includeExpired).toBe(true);
    });

    it('is not inverted by an empty string', async () => {
      // `?includeExpired=` arrives as ''. The `=== 'true'` idiom used by the
      // other routes would read this as false; here it must not.
      await controller.list(caller, undefined, undefined, undefined, undefined, undefined, undefined, '');

      expect(optionsFrom().includeExpired).toBe(true);
    });
  });

  describe('the other params still pass through', () => {
    it('forwards region, from, to and status untouched', async () => {
      await controller.list(caller, 'yangon', undefined, undefined, '2026-01-01', '2026-12-31', 'join');

      const options = optionsFrom();
      expect(options.region).toBe('yangon');
      expect(options.from).toBe('2026-01-01');
      expect(options.to).toBe('2026-12-31');
      expect(options.status).toBe('join');
    });

    it('converts radius to a number', async () => {
      await controller.list(caller, undefined, '16.8,96.1', '5000');

      expect(optionsFrom().radius).toBe(5000);
    });

    it('leaves radius undefined when absent, rather than NaN', async () => {
      // Number(undefined) is NaN, which would reach the geo query.
      await controller.list(caller);

      expect(optionsFrom().radius).toBeUndefined();
    });
  });
});
