import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Event, EventDocument } from './schemas/event.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from './schemas/event-player.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { CreateEventDto } from './dto/create-event.dto';
import { LocationsService } from '../locations/locations.service';

@Injectable()
export class EventsService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    private readonly locationsService: LocationsService,
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
      if (!member)
        throw new ForbiddenException(
          'Only group owner or admin can create events',
        );
    }
    // Destructure locationId out so the raw string is never spread onto the
    // model (Mongoose's loose create() typing would not flag the mismatch).
    const { locationId, ...rest } = dto;
    if (locationId) {
      // You may only attach a location you own (mirrors GroupsService).
      await this.locationsService.assertOwnedBy(locationId, userId);
    }
    return this.eventModel.create({
      ...rest,
      date: new Date(dto.date),
      groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : null,
      locationId: locationId ? new Types.ObjectId(locationId) : null,
      createdBy: new Types.ObjectId(userId),
    });
  }

  async findById(eventId: string): Promise<EventDocument> {
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async join(eventId: string, userId: string) {
    // Check existing player record first
    const existing = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
    });
    if (existing && existing.status === 'joined')
      throw new ConflictException('Already joined');

    // Atomic capacity check: only increment if joinedCount < maxPlayers and status is open
    const updatedEvent = await this.eventModel.findOneAndUpdate(
      {
        _id: eventId,
        status: 'open',
        $expr: { $lt: ['$joinedCount', '$maxPlayers'] },
      },
      { $inc: { joinedCount: 1 } },
      { new: true },
    );
    if (!updatedEvent) {
      const event = await this.eventModel.findById(eventId).lean();
      if (!event) throw new NotFoundException('Event not found');
      throw new BadRequestException(
        event.status !== 'open'
          ? 'Event is not open for joining'
          : 'Event is full',
      );
    }

    // Create or reactivate player record
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

    // Update status to 'full' if at capacity
    if (updatedEvent.joinedCount >= updatedEvent.maxPlayers) {
      await this.eventModel.findByIdAndUpdate(eventId, {
        $set: { status: 'full' },
      });
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

    // Use a single update: decrement and conditionally reopen if was 'full'
    await this.eventModel.findOneAndUpdate(
      { _id: eventId, status: { $in: ['open', 'full'] } },
      [
        {
          $set: {
            joinedCount: { $subtract: ['$joinedCount', 1] },
            status: {
              $cond: {
                if: { $eq: ['$status', 'full'] },
                then: 'open',
                else: '$status',
              },
            },
          },
        },
      ],
      { updatePipeline: true } as any,
    );

    return { message: 'Left event successfully' };
  }

  async listPlayers(eventId: string) {
    return this.playerModel
      .find({ eventId: new Types.ObjectId(eventId), status: 'joined' })
      .populate('userId', 'name profileImage')
      .lean();
  }
}
