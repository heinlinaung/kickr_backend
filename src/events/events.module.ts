import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { Event, EventSchema } from './schemas/event.schema';
import { EventPlayer, EventPlayerSchema } from './schemas/event-player.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      // Needed for the group's rules on event detail and the ?region= filter.
      { name: Group.name, schema: GroupSchema },
    ]),
    LocationsModule,
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService, MongooseModule],
})
export class EventsModule {}
