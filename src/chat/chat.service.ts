import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import {
  clampLimit,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  keysetFilter,
  toPage,
} from '../common/pagination/cursor';

@Injectable()
export class ChatService {
  constructor(@InjectModel(Message.name) private messageModel: Model<MessageDocument>) {}

  async saveMessage(groupId: string, senderId: string, text: string): Promise<MessageDocument> {
    return this.messageModel.create({
      groupId: new Types.ObjectId(groupId),
      senderId: new Types.ObjectId(senderId),
      text,
    });
  }

  /**
   * Persists a message and returns it with the sender resolved.
   *
   * Separate from `saveMessage` because the REST route needs the sender's name
   * and avatar: a client rendering the response — or receiving the broadcast —
   * must not have to look up who sent it. The socket handler keeps using the
   * lighter `saveMessage`, since a socket client already knows its own name.
   *
   * The populated shape matches `getHistory`, so a message rendered from a
   * send looks identical to the same message rendered from history.
   */
  async createMessage(groupId: string, senderId: string, text: string) {
    const created = await this.saveMessage(groupId, senderId, text);

    const populated = await this.messageModel
      .findById(created._id)
      .populate('senderId', 'name profileImage')
      .lean();

    // findById cannot miss here — the document was just written — but the type
    // is nullable, and returning the unpopulated document beats throwing on a
    // message that was in fact saved.
    return populated ?? created.toJSON();
  }

  /**
   * One page of a group's messages, newest first.
   *
   * Keyset-paginated rather than capped: the previous version took a `limit`
   * (default 50, max 200) and offered no way past it, so a group's chat became
   * unreachable beyond its most recent 200 messages. Scrolling back is the
   * normal thing to do in a chat, so a hard ceiling was the wrong shape.
   *
   * `_id` is the tiebreaker, not decoration: two messages can share a
   * `createdAt` millisecond, and on `createdAt` alone the ordering is not
   * total — a page boundary landing inside such a pair would drop the other
   * one. That was a documented gap on this route and is now closed.
   */
  async getHistory(groupId: string, limit = DEFAULT_PAGE_LIMIT, cursor?: string) {
    const filter: Record<string, unknown> = {
      groupId: new Types.ObjectId(groupId),
    };

    // -1: history is newest-first, so paging forward means going OLDER, which
    // is `$lt`. Passing 1 would silently re-serve the page just fetched.
    if (cursor) {
      Object.assign(filter, keysetFilter(decodeCursor(cursor), 'createdAt', -1));
    }

    const size = clampLimit(limit);
    const rows = await this.messageModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(size + 1)
      .populate('senderId', 'name profileImage')
      .lean();

    return toPage(rows, size, (row) => ({
      d: new Date(row.createdAt).toISOString(),
      i: String(row._id),
    }));
  }
}
