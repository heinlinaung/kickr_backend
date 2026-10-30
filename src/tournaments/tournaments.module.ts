import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TournamentsController } from './tournaments.controller';
import { TournamentPhasesController } from './tournament-phases.controller';
import { TournamentMatchesController } from './tournament-matches.controller';
import { TournamentInvitationsController } from './tournament-invitations.controller';
import { TournamentLinkController } from './tournament-link.controller';
import { TournamentsService } from './tournaments.service';
import { TournamentPhasesService } from './tournament-phases.service';
import { TournamentInvitationsService } from './tournament-invitations.service';
import { Tournament, TournamentSchema } from './schemas/tournament.schema';
import {
  TournamentTeam,
  TournamentTeamSchema,
} from './schemas/tournament-team.schema';
import {
  TournamentMatch,
  TournamentMatchSchema,
} from './schemas/tournament-match.schema';
import {
  TournamentPhase,
  TournamentPhaseSchema,
} from './schemas/tournament-phase.schema';
import { LeagueGroup, LeagueGroupSchema } from './schemas/league-group.schema';
import {
  LeagueGroupTeam,
  LeagueGroupTeamSchema,
} from './schemas/league-group-team.schema';
import {
  KnockoutRound,
  KnockoutRoundSchema,
} from './schemas/knockout-round.schema';
import {
  QualificationResult,
  QualificationResultSchema,
} from './schemas/qualification-result.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import {
  TournamentInvitation,
  TournamentInvitationSchema,
} from './schemas/tournament-invitation.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tournament.name, schema: TournamentSchema },
      { name: TournamentTeam.name, schema: TournamentTeamSchema },
      { name: TournamentMatch.name, schema: TournamentMatchSchema },
      { name: TournamentPhase.name, schema: TournamentPhaseSchema },
      { name: LeagueGroup.name, schema: LeagueGroupSchema },
      { name: LeagueGroupTeam.name, schema: LeagueGroupTeamSchema },
      { name: KnockoutRound.name, schema: KnockoutRoundSchema },
      { name: QualificationResult.name, schema: QualificationResultSchema },
      { name: TournamentInvitation.name, schema: TournamentInvitationSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      { name: Group.name, schema: GroupSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [
    TournamentsController,
    TournamentPhasesController,
    TournamentMatchesController,
    TournamentInvitationsController,
    TournamentLinkController,
  ],
  providers: [
    TournamentsService,
    TournamentPhasesService,
    TournamentInvitationsService,
  ],
})
export class TournamentsModule {}
