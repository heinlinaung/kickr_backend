import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import {
  EventPlayer,
  EventPlayerSchema,
} from '../events/schemas/event-player.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import { Award, AwardSchema } from '../awards/schemas/award.schema';
import {
  AwardMemory,
  AwardMemorySchema,
} from '../awards/schemas/award-memory.schema';
import { AwardsModule } from '../awards/awards.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Friendship, FriendshipSchema } from './schemas/friendship.schema';
import {
  EventInvitation,
  EventInvitationSchema,
} from './schemas/event-invitation.schema';
import { FriendsController } from './friends.controller';
import { EventInvitationsController } from './event-invitations.controller';
import { FriendsService } from './friends.service';
import { EventInvitationsService } from './event-invitations.service';

/**
 * Friendships and friend-to-friend event invitations.
 *
 * Events, groups and users are read through schemas only — accepting an
 * invitation does its own atomic roster write rather than importing
 * EventsModule, which pulls in most of the app. AwardsModule and
 * NotificationsModule are leaves, so importing them closes no cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Friendship.name, schema: FriendshipSchema },
      { name: EventInvitation.name, schema: EventInvitationSchema },
      { name: User.name, schema: UserSchema },
      { name: Event.name, schema: EventSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      // Award counts on the friend profile.
      { name: Award.name, schema: AwardSchema },
      { name: AwardMemory.name, schema: AwardMemorySchema },
    ]),
    AwardsModule,
    NotificationsModule,
  ],
  controllers: [FriendsController, EventInvitationsController],
  providers: [FriendsService, EventInvitationsService],
  exports: [FriendsService],
})
export class FriendsModule {}
