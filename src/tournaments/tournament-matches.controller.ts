import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TournamentPhasesService } from './tournament-phases.service';
import { MatchResultDto } from './dto/match-result.dto';

@ApiTags('Tournaments')
@ApiBearerAuth()
@Controller('matches')
@UseGuards(JwtAuthGuard)
export class TournamentMatchesController {
  constructor(private readonly phases: TournamentPhasesService) {}

  @Patch(':matchId/result')
  @ApiOperation({
    summary: 'Save a tournament match result',
    description:
      'Records (or edits) the score of a league or knockout match. Organizer only (`403 NOT_ORGANIZER`).\n\n' +
      '**Body**\n' +
      '- `homeGoals` / `awayGoals`: required unless `forfeit` is set.\n' +
      '- `penalties`: knockout only, and only when the (aggregate) score is level.\n' +
      '- `cards`: yellow / red per side; feeds the `FAIR_PLAY` tiebreaker (yellow = 1, red = 3, fewer is better).\n' +
      '- `forfeit`: `HOME` or `AWAY`, the side that forfeited or did not show. Recorded as 3–0 for the ' +
      'opponent (league) or a walkover (knockout). Cannot be combined with `penalties`.\n\n' +
      '**League matches** (tournament `LEAGUE_IN_PROGRESS` or `QUALIFICATION_REVIEW`; a league-only ' +
      'tournament also while `COMPLETED`)\n' +
      '- A draw is a draw: `penalties` gives `PENALTIES_NOT_ALLOWED`.\n' +
      '- Group standings are recalculated immediately.\n' +
      '- When the last league match is recorded: `LEAGUE_KNOCKOUT` moves to `QUALIFICATION_REVIEW` and ' +
      'qualifiers are computed (and a bracket proposed if no ties are open); `LEAGUE` completes with ' +
      'placements 1–3, unless a tie at the top needs resolving.\n' +
      '- Locked once the knockout phase starts (`RESULT_LOCKED`).\n\n' +
      '**Knockout matches** (tournament `KNOCKOUT_IN_PROGRESS` or `COMPLETED`)\n' +
      '- A level score needs `penalties` with a winner (`KNOCKOUT_NEEDS_WINNER`); penalties on a decided ' +
      'score give `PENALTIES_NOT_ALLOWED`.\n' +
      '- Two-legged ties: leg 1 may end level and takes no penalties; leg 2 needs leg 1 first ' +
      '(`MATCH_NOT_READY`) and is decided on aggregate, then penalties.\n' +
      '- The winner is placed in the next-round match automatically (semi-final losers go to the ' +
      'third-place match if enabled). Recording the final (and third-place match) completes the tournament ' +
      'and sets `placements`.\n' +
      '- Editable until the next-round match has a result (`RESULT_LOCKED`).\n\n' +
      'Other errors: `MATCH_NOT_FOUND`; `MATCH_NOT_READY` for a bye, a voided match, or one still waiting ' +
      "for a team; `PHASE_NOT_READY` if the match's phase has not started.\n\n" +
      'Returns the updated match.',
  })
  saveResult(
    @Param('matchId') matchId: string,
    @CurrentUser() user: any,
    @Body() dto: MatchResultDto,
  ) {
    return this.phases.saveResult(matchId, user._id.toString(), dto);
  }
}
