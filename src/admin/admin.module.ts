import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
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
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    // Models are registered directly rather than importing GroupsModule /
    // EventsModule: this module only needs raw collection access, and going
    // through those services would drag in their permission checks — the very
    // thing these endpoints exist to bypass.
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      { name: Event.name, schema: EventSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
