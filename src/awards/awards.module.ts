// src/awards/awards.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  EventPlayer,
  EventPlayerSchema,
} from '../events/schemas/event-player.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { Award, AwardSchema } from './schemas/award.schema';
import { AwardMemory, AwardMemorySchema } from './schemas/award-memory.schema';
import { AwardsController } from './awards.controller';
import { AwardsService } from './awards.service';

/**
 * MVP and Group Challenge awards, and members' memories of group awards.
 *
 * A leaf: EventsModule imports this one (it gives the MVP and fires the
 * challenge award on `done`), so events, groups and users are read here
 * through schemas only — importing their modules would close a cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Award.name, schema: AwardSchema },
      { name: AwardMemory.name, schema: AwardMemorySchema },
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      { name: User.name, schema: UserSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [AwardsController],
  providers: [AwardsService],
  exports: [AwardsService],
})
export class AwardsModule {}
