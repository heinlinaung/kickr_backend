import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Opaque keyset ("cursor") pagination for search endpoints.
 *
 * Keyset rather than `.skip()`: skip re-scans and re-counts every preceding
 * document, so deep pages get linearly slower, and any insert or delete between
 * two requests shifts the offset — the client silently skips or repeats rows.
 * A keyset predicate asks "everything after THIS row" and is stable under
 * concurrent writes and index-friendly at any depth.
 *
 * The cursor is base64url JSON, and deliberately opaque: it is a position
 * marker, not an API. Clients must round-trip `nextCursor` untouched — the
 * encoding is free to change (a signature, a different sort key) without a
 * client release. Nothing secret goes in it: it holds only the sort key of the
 * last row returned, which the client just received anyway. It is NOT signed,
 * so treat a decoded cursor as untrusted input — hence the ObjectId validation
 * below, which stops a hand-crafted value reaching Mongoose's caster.
 */

/** The sort key of the last row on a page: an optional date plus its _id. */
export interface CursorPayload {
  /** ISO date of the last row, when the sort leads with a date. */
  d?: string;
  /** `_id` of the last row — the tiebreaker that makes the sort total. */
  i: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decodes a client-supplied cursor, or throws `400`.
 *
 * Every failure mode collapses to one `BadRequestException`: a cursor is opaque,
 * so there is nothing actionable to tell the caller beyond "this is not one of
 * ours, start from the first page".
 */
export function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BadRequestException('Invalid cursor');
  }
  const { d, i } = parsed as Record<string, unknown>;

  // `i` is interpolated into a query, so it must be a real ObjectId — not just
  // a string. Mongoose would otherwise throw a CastError as a 500.
  if (typeof i !== 'string' || !Types.ObjectId.isValid(i)) {
    throw new BadRequestException('Invalid cursor');
  }
  if (d !== undefined) {
    if (typeof d !== 'string' || Number.isNaN(Date.parse(d))) {
      throw new BadRequestException('Invalid cursor');
    }
  }

  return d === undefined ? { i } : { d, i };
}

/**
 * The `$or` keyset predicate for a `{ <dateField>: 1, _id: 1 }` sort.
 *
 * "Strictly after (date, _id)" is two cases, not one: a later date, or the same
 * date with a greater `_id`. Comparing the date alone would drop every other
 * row sharing that timestamp — the bug this exists to prevent.
 */
export function keysetFilter(
  payload: CursorPayload,
  dateField: string,
): Record<string, unknown> {
  const id = new Types.ObjectId(payload.i);
  if (payload.d === undefined) return { _id: { $gt: id } };

  const date = new Date(payload.d);
  return {
    $or: [{ [dateField]: { $gt: date } }, { [dateField]: date, _id: { $gt: id } }],
  };
}

/** A page of results plus the marker for the next one. */
export interface Page<T> {
  items: T[];
  /** Feed back as `?cursor=`; `null` at the end of the result set. */
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Splits a `limit + 1` result set into a page.
 *
 * The extra row is a lookahead: its presence is what proves another page
 * exists. That keeps `hasMore` honest without a second `countDocuments()` —
 * which on a regex query would double the work to answer a question the client
 * only needs a boolean for.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  makeCursor: (row: T) => CursorPayload,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(makeCursor(last)) : null,
  };
}
