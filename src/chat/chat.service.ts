import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema';

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

  async getHistory(groupId: string, limit = 50) {
    return this.messageModel
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('senderId', 'name profileImage')
      .lean();
  }
}
