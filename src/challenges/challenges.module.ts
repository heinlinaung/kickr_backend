// src/challenges/challenges.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { Challenge, ChallengeSchema } from './schemas/challenge.schema';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';

/**
 * The group-vs-group handshake. EventsModule is imported for the proposal
 * event (`POST /challenges/:id/event` delegates to EventsService); the
 * reverse direction is schema-only inside EventsModule, so no cycle forms.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Challenge.name, schema: ChallengeSchema },
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
    ]),
    NotificationsModule,
    EventsModule,
  ],
  controllers: [ChallengesController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
