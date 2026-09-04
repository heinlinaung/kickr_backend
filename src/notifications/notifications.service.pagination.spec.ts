// src/notifications/notifications.service.pagination.spec.ts
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';
import { Notification } from './schemas/notification.schema';
import { User } from '../users/schemas/user.schema';
import { encodeCursor } from '../common/pagination/cursor';

const USER = '507f191e810c19729de860e1';

describe('NotificationsService — paginated listing', () => {
  let service: NotificationsService;
  const notifModel: any = {};
  const query: any = {};

  /** Rows one millisecond apart, newest first, as the real sort returns. */
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      _id: new Types.ObjectId(),
      title: `n${index}`,
      isRead: false,
      createdAt: new Date(Date.UTC(2026, 8, 4, 12, 0, 0, count - index)),
    }));

  const listWith = (result: any[]) => {
    query.lean = jest.fn().mockResolvedValue(result);
    return query;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    query.sort = jest.fn().mockReturnThis();
    query.limit = jest.fn().mockReturnThis();
    query.lean = jest.fn().mockResolvedValue([]);
    notifModel.find = jest.fn().mockReturnValue(query);

    const m = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: notifModel },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: PushService, useValue: {} },
        { provide: NotificationsGateway, useValue: {} },
      ],
    }).compile();
    service = m.get(NotificationsService);
  });

  it('returns a page envelope, not a bare array', async () => {
    listWith(rows(3));

    const res = await service.findForUser(USER);

    expect(res).toEqual(
      expect.objectContaining({ items: expect.any(Array), hasMore: false }),
    );
    expect(res.nextCursor).toBeNull();
  });

  it('scopes the query to the caller', async () => {
    await service.findForUser(USER);

    expect(String(notifModel.find.mock.calls[0][0].userId)).toBe(USER);
  });

  it('sorts newest first with _id as the tiebreaker', async () => {
    // Two notifications from one fan-out share a createdAt to the millisecond.
    // Without _id the sort is not total, so a page boundary landing inside that
    // group would drop the rest of it.
    await service.findForUser(USER);

    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  });

  it('does NOT sort by isRead', async () => {
    // isRead is mutable: marking a row read mid-pagination would move it
    // between pages and make the cursor skip or repeat a row.
    await service.findForUser(USER);

    const sort = query.sort.mock.calls[0][0];
    expect(sort).not.toHaveProperty('isRead');
  });

  describe('page size', () => {
    it('defaults to 20 and over-fetches by one', async () => {
      // The extra row is the lookahead that proves another page exists,
      // avoiding a second countDocuments.
      await service.findForUser(USER);

      expect(query.limit).toHaveBeenCalledWith(21);
    });

    it('honours an explicit limit', async () => {
      await service.findForUser(USER, 5);

      expect(query.limit).toHaveBeenCalledWith(6);
    });

    it('caps the page at 50', async () => {
      await service.findForUser(USER, 5000);

      expect(query.limit).toHaveBeenCalledWith(51);
    });

    it('falls back to the default for a non-numeric limit', async () => {
      // `?limit=abc` reaches the service as NaN. Every NaN comparison is
      // false, so an unguarded clamp yields NaN and .limit(NaN) returns the
      // whole collection.
      await service.findForUser(USER, Number('abc'));

      expect(query.limit).toHaveBeenCalledWith(21);
    });

    it('treats a limit below 1 as 1', async () => {
      await service.findForUser(USER, 0);

      expect(query.limit).toHaveBeenCalledWith(2);
    });
  });

  describe('cursor', () => {
    it('omits the keyset filter on the first page', async () => {
      await service.findForUser(USER);

      expect(notifModel.find.mock.calls[0][0].$or).toBeUndefined();
    });

    it('pages forward with $lt, because the feed is descending', async () => {
      // The single most likely bug here: $gt would silently re-serve the page
      // the client already had.
      const id = new Types.ObjectId();
      const when = new Date(Date.UTC(2026, 8, 4, 12, 0, 0));
      const cursor = encodeCursor({ d: when.toISOString(), i: String(id) });

      await service.findForUser(USER, 20, cursor);

      const filter = notifModel.find.mock.calls[0][0];
      expect(filter.$or).toEqual([
        { createdAt: { $lt: when } },
        { createdAt: when, _id: { $lt: id } },
      ]);
    });

    it('keeps the user scope alongside the keyset', async () => {
      // A keyset that replaced the filter would leak other users' rows.
      const cursor = encodeCursor({
        d: new Date().toISOString(),
        i: String(new Types.ObjectId()),
      });

      await service.findForUser(USER, 20, cursor);

      const filter = notifModel.find.mock.calls[0][0];
      expect(String(filter.userId)).toBe(USER);
      expect(filter.$or).toBeDefined();
    });

    it('rejects a malformed cursor with 400', async () => {
      await expect(
        service.findForUser(USER, 20, 'not-a-cursor'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a cursor whose id is not an ObjectId', async () => {
      // Cursors are unsigned, so a decoded one is untrusted input; an
      // unvalidated id would reach Mongoose's caster and 500.
      const forged = encodeCursor({
        d: new Date().toISOString(),
        i: 'nope',
      } as any);

      await expect(
        service.findForUser(USER, 20, forged),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('lookahead', () => {
    it('trims the extra row and reports hasMore', async () => {
      listWith(rows(6)); // limit 5 + 1

      const res = await service.findForUser(USER, 5);

      expect(res.items).toHaveLength(5);
      expect(res.hasMore).toBe(true);
      expect(res.nextCursor).not.toBeNull();
    });

    it('ends the set when the lookahead row is absent', async () => {
      listWith(rows(4));

      const res = await service.findForUser(USER, 5);

      expect(res.items).toHaveLength(4);
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it('handles an empty page', async () => {
      listWith([]);

      const res = await service.findForUser(USER);

      expect(res).toEqual({ items: [], hasMore: false, nextCursor: null });
    });

    it('builds the cursor from the LAST returned row, not the lookahead', async () => {
      // Encoding the lookahead row would skip it on the next page.
      const page = rows(4); // limit 3 + 1
      listWith(page);

      const res = await service.findForUser(USER, 3);

      const decoded = JSON.parse(
        Buffer.from(res.nextCursor as string, 'base64url').toString('utf8'),
      );
      expect(decoded.i).toBe(String(page[2]._id));
      expect(decoded.i).not.toBe(String(page[3]._id));
    });
  });
});
