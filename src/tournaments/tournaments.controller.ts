import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTeamDto } from './dto/register-team.dto';
import { UpdateMatchDto } from './dto/update-match.dto';

@ApiTags('Tournaments')
@ApiBearerAuth()
@Controller('tournaments')
@UseGuards(JwtAuthGuard)
export class TournamentsController {
  constructor(private tournamentsService: TournamentsService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create(user._id.toString(), dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tournamentsService.findById(id);
  }

  @Post(':id/teams')
  registerTeam(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: RegisterTeamDto,
  ) {
    return this.tournamentsService.registerTeam(id, user._id.toString(), dto);
  }

  @Patch(':id/matches/:matchId')
  updateMatch(
    @Param('id') tournamentId: string,
    @Param('matchId') matchId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateMatchDto,
  ) {
    return this.tournamentsService.updateMatch(tournamentId, matchId, user._id.toString(), dto);
  }
}
