// src/ratings/ratings.controller.spec.ts
import { Test } from '@nestjs/testing';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

describe('RatingsController', () => {
  let controller: RatingsController;

  const CALLER = { _id: 'u1' };
  const svc = {
    submit: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue({ items: [] }),
    summary: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue({ message: 'Rating deleted' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [RatingsController],
      providers: [{ provide: RatingsService, useValue: svc }],
    }).compile();
    controller = m.get(RatingsController);
  });

  it('POST /ratings passes the caller and body through', async () => {
    const dto: any = { targetType: 'event', targetId: 'e1', stars: 5 };
    await controller.submit(CALLER, dto);
    expect(svc.submit).toHaveBeenCalledWith('u1', dto);
  });

  it('GET /ratings/summary passes the caller for myRating', async () => {
    await controller.summary(CALLER, 'group', 'g1');
    expect(svc.summary).toHaveBeenCalledWith('group', 'g1', 'u1');
  });

  describe('GET /ratings', () => {
    it('delegates the target and viewer', async () => {
      await controller.list(CALLER, 'event', 'e1');
      expect(svc.list).toHaveBeenCalledWith(
        'event',
        'e1',
        undefined,
        undefined,
        'u1',
      );
    });

    it('passes a numeric limit through as a number', async () => {
      await controller.list(CALLER, 'event', 'e1', '35');
      expect(svc.list).toHaveBeenCalledWith('event', 'e1', 35, undefined, 'u1');
    });

    it('forwards a non-numeric limit as NaN for clampLimit to reject', async () => {
      await controller.list(CALLER, 'event', 'e1', 'abc');
      const [, , limit] = svc.list.mock.calls[0];
      expect(Number.isNaN(limit)).toBe(true);
    });

    it('forwards the cursor verbatim — it is opaque here', async () => {
      await controller.list(CALLER, 'event', 'e1', undefined, 'eyJpIjoiYWJjIn0');
      expect(svc.list).toHaveBeenCalledWith(
        'event',
        'e1',
        undefined,
        'eyJpIjoiYWJjIn0',
        'u1',
      );
    });
  });

  it('DELETE /ratings/:id passes the caller for the author check', async () => {
    await controller.remove(CALLER, 'r1');
    expect(svc.remove).toHaveBeenCalledWith('r1', 'u1');
  });
});
