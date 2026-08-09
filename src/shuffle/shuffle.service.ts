import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventPlayer, EventPlayerDocument } from '../events/schemas/event-player.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import { GroupMember, GroupMemberDocument } from '../groups/schemas/group-member.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { canShuffle } from '../events/events.lifecycle';

@Injectable()
export class ShuffleService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name) private playerModel: Model<EventPlayerDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
    private notificationsService: NotificationsService,
  ) {}

  async shuffle(eventId: string, requesterId: string) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');

    if (event.groupId) {
      const member = await this.memberModel.findOne({
        groupId: event.groupId,
        userId: new Types.ObjectId(requesterId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      if (!member) throw new ForbiddenException('Only group owner or admin can shuffle players');
    } else if (event.createdBy.toString() !== requesterId) {
      throw new ForbiddenException('Only event creator can shuffle players');
    }

    // Spec §4.1: shuffling is a `preparation`-only operation. Previously this
    // ran in any state, so teams could be reassigned mid-match.
    if (!canShuffle(event.status)) {
      throw new BadRequestException(
        `Teams can only be shuffled during preparation (event is '${event.status}')`,
      );
    }

    const players = await this.playerModel
      .find({ eventId: new Types.ObjectId(eventId), status: 'joined' })
      .lean();

    const shuffled = fisherYates([...players]);
    const GROUP_SIZE = 6;

    const bulkOps = shuffled.map((player, index) => {
      const groupNumber = Math.floor(index / GROUP_SIZE) + 1;
      return {
        updateOne: {
          filter: { _id: player._id },
          update: { $set: { team: String(groupNumber) } },
        },
      };
    });

    if (bulkOps.length > 0) {
      await this.playerModel.bulkWrite(bulkOps);
    }

    await Promise.all(
      shuffled.map((player) =>
        this.notificationsService.create({
          userId: player.userId.toString(),
          title: 'Teams shuffled!',
          body: 'Players have been shuffled for the event. Check your team assignment.',
          type: 'event',
          refId: eventId,
        }),
      ),
    );

    return { message: `${shuffled.length} players shuffled into groups of ${GROUP_SIZE}` };
  }
}

function fisherYates<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
