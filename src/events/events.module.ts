import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsController } from './events.controller';
import { EventTemplatesController } from './event-templates.controller';
import { EventsService } from './events.service';
import { Event, EventSchema } from './schemas/event.schema';
import { EventPlayer, EventPlayerSchema } from './schemas/event-player.schema';
import { EventMatch, EventMatchSchema } from './schemas/event-match.schema';
import { Team, TeamSchema } from './schemas/team.schema';
import {
  EventTeamChat,
  EventTeamChatSchema,
} from './schemas/event-team-chat.schema';
import { EventLike, EventLikeSchema } from './schemas/event-like.schema';
import {
  EventTemplate,
  EventTemplateSchema,
} from './schemas/event-template.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import { Location, LocationSchema } from '../locations/schemas/location.schema';
import { LocationsModule } from '../locations/locations.module';
import { UploadModule } from '../common/upload/upload.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      // Needed for the group's rules on event detail and the ?region= filter.
      { name: Group.name, schema: GroupSchema },
      // Step 2-4 collections: fixtures, team chats, likes and templates.
      { name: EventMatch.name, schema: EventMatchSchema },
      { name: Team.name, schema: TeamSchema },
      { name: EventTeamChat.name, schema: EventTeamChatSchema },
      { name: EventLike.name, schema: EventLikeSchema },
      { name: EventTemplate.name, schema: EventTemplateSchema },
      // Read directly for $geoNear — it must be the first aggregation stage,
      // so the geo query starts from locations rather than from events.
      { name: Location.name, schema: LocationSchema },
    ]),
    LocationsModule,
    UploadModule,
    NotificationsModule,
  ],
  controllers: [EventsController, EventTemplatesController],
  providers: [EventsService],
  exports: [EventsService, MongooseModule],
})
export class EventsModule {}
