// src/global-football-teams/global-football-teams.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlobalFootballTeamsController } from './global-football-teams.controller';
import { GlobalFootballTeamsService } from './global-football-teams.service';
import {
  GlobalFootballTeam,
  GlobalFootballTeamSchema,
} from './schemas/global-football-team.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GlobalFootballTeam.name, schema: GlobalFootballTeamSchema },
    ]),
    // No AuthModule import: JwtAuthGuard resolves its passport strategy from
    // the app-level registration, the same way LocationsModule uses the guard
    // without importing it. NotificationsModule imports AuthModule only
    // because its gateway injects CognitoJwtVerifier directly.
  ],
  controllers: [GlobalFootballTeamsController],
  providers: [GlobalFootballTeamsService],
  // Exported so a later feature (a favourite-team field on the user profile)
  // can validate an id without duplicating the model registration.
  exports: [GlobalFootballTeamsService],
})
export class GlobalFootballTeamsModule {}
