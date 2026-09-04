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
import {
  GlobalFootballTeam,
  GlobalFootballTeamSchema,
} from '../global-football-teams/schemas/global-football-team.schema';

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
    ]),
    UploadModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
