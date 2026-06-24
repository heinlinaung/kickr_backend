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

  async getHistory(groupId: string, limit = 50) {
    return this.messageModel
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('senderId', 'name profileImage')
      .lean();
  }
}
