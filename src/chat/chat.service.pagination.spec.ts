// src/chat/chat.service.pagination.spec.ts
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ChatService } from './chat.service';
import { encodeCursor } from '../common/pagination/cursor';

const GROUP = '6a6b2366f78b66d63a911a9e';

describe('ChatService.getHistory — cursor pagination', () => {
  let service: ChatService;
  const model: any = {};
  const query: any = {};

  /** Messages one millisecond apart, newest first, as the real sort returns. */
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      _id: new Types.ObjectId(),
      text: `m${index}`,
      senderId: { _id: 'u1', name: 'Hein' },
      createdAt: new Date(Date.UTC(2026, 8, 6, 10, 0, 0, count - index)),
    }));

  const returning = (result: any[]) => {
    query.lean = jest.fn().mockResolvedValue(result);
    return query;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    query.sort = jest.fn().mockReturnThis();
    query.limit = jest.fn().mockReturnThis();
    query.populate = jest.fn().mockReturnThis();
    query.lean = jest.fn().mockResolvedValue([]);
    model.find = jest.fn().mockReturnValue(query);
    service = new ChatService(model);
  });

  it('returns a page envelope, not a bare array', async () => {
    returning(rows(3));

    const res = await service.getHistory(GROUP);

    expect(res).toEqual(
      expect.objectContaining({ items: expect.any(Array), hasMore: false }),
    );
    expect(res.nextCursor).toBeNull();
  });

  it('scopes the query to the group', async () => {
    await service.getHistory(GROUP);

    expect(String(model.find.mock.calls[0][0].groupId)).toBe(GROUP);
  });

  it('sorts newest first with _id as the tiebreaker', async () => {
    // Two messages can share a createdAt millisecond. On createdAt alone the
    // ordering is not total, so a page boundary landing inside such a pair
    // would drop the other one — a gap this route previously had.
    await service.getHistory(GROUP);

    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  });

  it('still populates the sender', async () => {
    // A paginated page must render the same as an unpaginated one did.
    await service.getHistory(GROUP);

    expect(query.populate).toHaveBeenCalledWith('senderId', 'name profileImage');
  });

  describe('page size', () => {
    it('defaults to 20 and over-fetches by one', async () => {
      await service.getHistory(GROUP);

      expect(query.limit).toHaveBeenCalledWith(21);
    });

    it('honours an explicit limit', async () => {
      await service.getHistory(GROUP, 5);

      expect(query.limit).toHaveBeenCalledWith(6);
    });

    it('caps the page at 50, well below the old 200', async () => {
      await service.getHistory(GROUP, 5000);

      expect(query.limit).toHaveBeenCalledWith(51);
    });

    it('falls back to the default for a non-numeric limit', async () => {
      // `?limit=abc` arrives as NaN. An unguarded clamp yields NaN, and
      // .limit(NaN) returns the whole collection.
      await service.getHistory(GROUP, Number('abc'));

      expect(query.limit).toHaveBeenCalledWith(21);
    });
  });

  describe('cursor', () => {
    it('omits the keyset filter on the first page', async () => {
      await service.getHistory(GROUP);

      expect(model.find.mock.calls[0][0].$or).toBeUndefined();
    });

    it('pages backwards in time with $lt', async () => {
      // The likeliest bug: $gt would silently re-serve the page just fetched,
      // which in a chat looks like the scroll being stuck.
      const id = new Types.ObjectId();
      const when = new Date(Date.UTC(2026, 8, 6, 10, 0, 0));
      const cursor = encodeCursor({ d: when.toISOString(), i: String(id) });

      await service.getHistory(GROUP, 20, cursor);

      expect(model.find.mock.calls[0][0].$or).toEqual([
        { createdAt: { $lt: when } },
        { createdAt: when, _id: { $lt: id } },
      ]);
    });

    it('keeps the group scope alongside the keyset', async () => {
      // A keyset that replaced the filter would leak other groups' messages —
      // the worst possible failure on a private chat.
      const cursor = encodeCursor({
        d: new Date().toISOString(),
        i: String(new Types.ObjectId()),
      });

      await service.getHistory(GROUP, 20, cursor);

      const filter = model.find.mock.calls[0][0];
      expect(String(filter.groupId)).toBe(GROUP);
      expect(filter.$or).toBeDefined();
    });

    it('rejects a malformed cursor with 400', async () => {
      await expect(
        service.getHistory(GROUP, 20, 'not-a-cursor'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a forged cursor whose id is not an ObjectId', async () => {
      // Cursors are unsigned, so a decoded one is untrusted input; an
      // unvalidated id would reach Mongoose's caster and 500.
      const forged = encodeCursor({
        d: new Date().toISOString(),
        i: 'nope',
      } as any);

      await expect(
        service.getHistory(GROUP, 20, forged),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('lookahead', () => {
    it('trims the extra row and reports hasMore', async () => {
      returning(rows(6)); // limit 5 + 1

      const res = await service.getHistory(GROUP, 5);

      expect(res.items).toHaveLength(5);
      expect(res.hasMore).toBe(true);
      expect(res.nextCursor).not.toBeNull();
    });

    it('ends the conversation when the lookahead row is absent', async () => {
      returning(rows(4));

      const res = await service.getHistory(GROUP, 5);

      expect(res.items).toHaveLength(4);
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it('handles a group with no messages', async () => {
      returning([]);

      const res = await service.getHistory(GROUP);

      expect(res).toEqual({ items: [], hasMore: false, nextCursor: null });
    });

    it('builds the cursor from the LAST returned row, not the lookahead', async () => {
      // Encoding the lookahead row would skip a message on the next page —
      // in a chat, a silently missing message.
      const page = rows(4); // limit 3 + 1
      returning(page);

      const res = await service.getHistory(GROUP, 3);

      const decoded = JSON.parse(
        Buffer.from(res.nextCursor as string, 'base64url').toString('utf8'),
      );
      expect(decoded.i).toBe(String(page[2]._id));
      expect(decoded.i).not.toBe(String(page[3]._id));
    });
  });
});
