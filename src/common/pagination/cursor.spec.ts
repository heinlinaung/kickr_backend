// src/common/pagination/cursor.spec.ts
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  encodeCursor,
  decodeCursor,
  keysetFilter,
  toPage,
} from './cursor';

describe('cursor pagination helpers', () => {
  const ID = '507f1f77bcf86cd799439011';
  const DATE = '2026-09-01T10:00:00.000Z';

  describe('encode / decode', () => {
    it('round-trips an id-only cursor', () => {
      expect(decodeCursor(encodeCursor({ i: ID }))).toEqual({ i: ID });
    });

    it('round-trips a date+id cursor', () => {
      const payload = { d: DATE, i: ID };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('produces a URL-safe string', () => {
      // base64url: no +, / or = to be mangled in a query string.
      const c = encodeCursor({ d: DATE, i: ID });
      expect(c).not.toMatch(/[+/=]/);
    });

    it('is opaque — not readable as plain JSON', () => {
      expect(encodeCursor({ i: ID })).not.toContain(ID);
    });
  });

  describe('decode rejects bad input', () => {
    it.each([
      ['not base64 at all', 'not-a-cursor!!'],
      ['valid base64, not JSON', Buffer.from('hello').toString('base64url')],
      ['JSON but not an object', Buffer.from('42').toString('base64url')],
      ['null', Buffer.from('null').toString('base64url')],
      ['missing i', Buffer.from('{"d":"x"}').toString('base64url')],
      ['non-string i', Buffer.from('{"i":42}').toString('base64url')],
    ])('rejects %s', (_label, cursor) => {
      expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
    });

    it('rejects an _id that is not a valid ObjectId', () => {
      // Cursors are unsigned, so a forged one must never reach Mongoose's
      // caster — that would surface as a 500 instead of a 400.
      const forged = Buffer.from('{"i":"nope"}').toString('base64url');
      expect(() => decodeCursor(forged)).toThrow(BadRequestException);
    });

    it('rejects an unparseable date', () => {
      const bad = Buffer.from(
        JSON.stringify({ d: 'not-a-date', i: ID }),
      ).toString('base64url');
      expect(() => decodeCursor(bad)).toThrow(BadRequestException);
    });
  });

  describe('keysetFilter', () => {
    it('is a plain _id comparison when there is no date', () => {
      const f: any = keysetFilter({ i: ID }, '_id');
      expect(f._id.$gt.toString()).toBe(ID);
      expect(f.$or).toBeUndefined();
    });

    it('covers both tie cases for a date sort', () => {
      const f: any = keysetFilter({ d: DATE, i: ID }, 'date');

      // Later date, OR same date with a greater _id. Comparing the date alone
      // would drop every other row sharing that exact timestamp.
      expect(f.$or).toHaveLength(2);
      expect(f.$or[0].date.$gt).toEqual(new Date(DATE));
      expect(f.$or[1].date).toEqual(new Date(DATE));
      expect(f.$or[1]._id.$gt.toString()).toBe(ID);
    });

    it('honours the field name it is given', () => {
      const f: any = keysetFilter({ d: DATE, i: ID }, 'createdAt');
      expect(f.$or[0].createdAt).toBeDefined();
      expect(f.$or[0].date).toBeUndefined();
    });
  });

  describe('toPage', () => {
    const mk = (n: number) =>
      Array.from({ length: n }, () => ({ _id: new Types.ObjectId() }));

    const cur = (row: any) => ({ i: String(row._id) });

    it('drops the lookahead row and reports hasMore', () => {
      const page = toPage(mk(4), 3, cur);
      expect(page.items).toHaveLength(3);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).not.toBeNull();
    });

    it('reports the end when the lookahead row is absent', () => {
      const page = toPage(mk(2), 3, cur);
      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('treats an exactly-full page as the end', () => {
      // limit rows and no lookahead means there is nothing after them.
      const page = toPage(mk(3), 3, cur);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('handles an empty result set without inventing a cursor', () => {
      const page = toPage([], 3, cur);
      expect(page.items).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('builds the cursor from the LAST returned row, not the lookahead', () => {
      const rows = mk(4);
      const page = toPage(rows, 3, cur);
      // Row index 2 is the last item the client actually received.
      expect(page.nextCursor).toBe(encodeCursor({ i: String(rows[2]._id) }));
    });
  });
});
