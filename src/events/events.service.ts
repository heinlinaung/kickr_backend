import {
  Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Event, EventDocument } from './schemas/event.schema';
import { EventPlayer, EventPlayerDocument } from './schemas/event-player.schema';
import { GroupMember, GroupMemberDocument } from '../groups/schemas/group-member.schema';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class EventsService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name) private playerModel: Model<EventPlayerDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
  ) {}

  async list(userId: string) {
    return this.eventModel.find({ isPublic: true }).sort({ date: 1 }).lean();
  }

  async create(userId: string, dto: CreateEventDto): Promise<EventDocument> {
    if (dto.groupId) {
      const member = await this.memberModel.findOne({
        groupId: new Types.ObjectId(dto.groupId),
        userId: new Types.ObjectId(userId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      if (!member) throw new ForbiddenException('Only group owner or admin can create events');
    }
    return this.eventModel.create({
      ...dto,
      date: new Date(dto.date),
      groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : null,
      createdBy: new Types.ObjectId(userId),
    });
  }

  async findById(eventId: string): Promise<EventDocument> {
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) throw new NotFoundException('Event not found');
    return event as unknown as EventDocument;
  }

  async join(eventId: string, userId: string) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== 'open') throw new BadRequestException('Event is not open for joining');
    if (event.joinedCount >= event.maxPlayers) throw new BadRequestException('Event is full');

    const existing = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
    });
    if (existing && existing.status === 'joined') throw new ConflictException('Already joined');
    if (existing && existing.status === 'cancelled') {
      existing.status = 'joined';
      existing.joinedAt = new Date();
      await existing.save();
    } else {
      await this.playerModel.create({
        eventId: new Types.ObjectId(eventId),
        userId: new Types.ObjectId(userId),
        joinedAt: new Date(),
        status: 'joined',
      });
    }

    await this.eventModel.findByIdAndUpdate(eventId, { $inc: { joinedCount: 1 } });
    if (event.joinedCount + 1 >= event.maxPlayers) {
      await this.eventModel.findByIdAndUpdate(eventId, { $set: { status: 'full' } });
    }

    return { message: 'Joined event successfully' };
  }

  async leave(eventId: string, userId: string) {
    const player = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
      status: 'joined',
    });
    if (!player) throw new NotFoundException('You have not joined this event');

    player.status = 'cancelled';
    await player.save();
    await this.eventModel.findByIdAndUpdate(eventId, {
      $inc: { joinedCount: -1 },
      $set: { status: 'open' },
    });

    return { message: 'Left event successfully' };
  }

  async listPlayers(eventId: string) {
    return this.playerModel
      .find({ eventId: new Types.ObjectId(eventId), status: 'joined' })
      .populate('userId', 'name profileImage')
      .lean();
  }
}
