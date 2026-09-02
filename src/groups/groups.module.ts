import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { Group, GroupSchema } from './schemas/group.schema';
import { GroupMember, GroupMemberSchema } from './schemas/group-member.schema';
import { UploadModule } from '../common/upload/upload.module';
import { EventsModule } from '../events/events.module';
import { Message, MessageSchema } from '../chat/schemas/message.schema';
import {
  Tournament,
  TournamentSchema,
} from '../tournaments/schemas/tournament.schema';
import {
  Location,
  LocationSchema,
} from '../locations/schemas/location.schema';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      // Cleared by the group-delete cascade. Registered here as schemas rather
      // than imported through ChatModule/TournamentsModule, both of which
      // import GroupsModule — the reverse would be a circular dependency.
      { name: Message.name, schema: MessageSchema },
      { name: Tournament.name, schema: TournamentSchema },
      { name: Location.name, schema: LocationSchema },
    ]),
    EventsModule,
    UploadModule,
    LocationsModule,
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService, MongooseModule],
})
export class GroupsModule {}
