import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TestDataService } from './test-data.service';
import { TestRun, TestRunSchema } from './schemas/test-run.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import {
  EventPlayer,
  EventPlayerSchema,
} from '../events/schemas/event-player.schema';
import {
  EventMatch,
  EventMatchSchema,
} from '../events/schemas/event-match.schema';
import {
  EventTeamChat,
  EventTeamChatSchema,
} from '../events/schemas/event-team-chat.schema';
import {
  EventLike,
  EventLikeSchema,
} from '../events/schemas/event-like.schema';
import { Location, LocationSchema } from '../locations/schemas/location.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AuthModule } from '../auth/auth.module';
import { GroupsModule } from '../groups/groups.module';
import { LocationsModule } from '../locations/locations.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    // Models are registered directly rather than importing GroupsModule /
    // EventsModule: the force-add endpoints only need raw collection access,
    // and going through those services would drag in their permission checks —
    // the very thing those endpoints exist to bypass.
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      { name: Event.name, schema: EventSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: EventMatch.name, schema: EventMatchSchema },
      { name: EventTeamChat.name, schema: EventTeamChatSchema },
      { name: EventLike.name, schema: EventLikeSchema },
      { name: Location.name, schema: LocationSchema },
      { name: User.name, schema: UserSchema },
      { name: TestRun.name, schema: TestRunSchema },
    ]),
    // The test-data endpoint is the opposite case: it drives the real services
    // precisely so their permission checks and lifecycle gates are what gets
    // exercised. AuthModule supplies CognitoService for user create/delete.
    AuthModule,
    GroupsModule,
    LocationsModule,
    EventsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, TestDataService],
})
export class AdminModule {}
