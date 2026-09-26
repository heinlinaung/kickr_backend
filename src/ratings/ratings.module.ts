// src/ratings/ratings.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
import { User, UserSchema } from '../users/schemas/user.schema';
import { Rating, RatingSchema } from './schemas/rating.schema';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

/**
 * Deliberately a leaf, like Plans: eligibility needs to READ groups, members,
 * events and rosters, so it registers their schemas directly rather than
 * importing their modules — which would close a cycle the moment Users
 * imports this module for profile `avgRating`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Rating.name, schema: RatingSchema },
      { name: Event.name, schema: EventSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
