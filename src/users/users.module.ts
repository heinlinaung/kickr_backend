import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import {
  EventPlayer,
  EventPlayerSchema,
} from '../events/schemas/event-player.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { UploadModule } from '../common/upload/upload.module';
import { SportTypesModule } from '../sport-types/sport-types.module';
import {
  GlobalFootballTeam,
  GlobalFootballTeamSchema,
} from '../global-football-teams/schemas/global-football-team.schema';
import { RatingsModule } from '../ratings/ratings.module';
import { EventsModule } from '../events/events.module';
import { Group, GroupSchema } from '../groups/schemas/group.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: Event.name, schema: EventSchema },
      // Registered as a SCHEMA rather than importing GlobalFootballTeamsModule:
      // populate() on User.favouriteTeamId needs the model registered on this
      // connection, and this avoids coupling the modules for a read-only join.
      {
        name: GlobalFootballTeam.name,
        schema: GlobalFootballTeamSchema,
      },
      // For the owned-groups guard in account deletion — a read, so the
      // schema is registered rather than importing GroupsModule (which
      // imports EventsModule and would widen the graph for one query).
      { name: Group.name, schema: GroupSchema },
    ]),
    UploadModule,
    // For profile sports/preferredSport validation against the `sporttypes`
    // collection. A leaf module, so no cycle risk.
    SportTypesModule,
    // For profile statistics' avgRating (§4.10). Also a leaf — no cycle.
    RatingsModule,
    // Account deletion cancels the user's unfinished events and leaves open
    // rosters through the REAL cancel/leave flows (notifications, chat
    // archiving, joinedCount). EventsModule does not import UsersModule, so
    // this closes no cycle.
    EventsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
