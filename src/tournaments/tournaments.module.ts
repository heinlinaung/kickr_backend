import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { Tournament, TournamentSchema } from './schemas/tournament.schema';
import { TournamentTeam, TournamentTeamSchema } from './schemas/tournament-team.schema';
import { TournamentMatch, TournamentMatchSchema } from './schemas/tournament-match.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tournament.name, schema: TournamentSchema },
      { name: TournamentTeam.name, schema: TournamentTeamSchema },
      { name: TournamentMatch.name, schema: TournamentMatchSchema },
    ]),
  ],
  controllers: [TournamentsController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
