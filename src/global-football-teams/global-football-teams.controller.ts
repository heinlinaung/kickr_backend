// src/global-football-teams/global-football-teams.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GlobalFootballTeamsService } from './global-football-teams.service';

@ApiTags('Global football teams')
@ApiBearerAuth()
@Controller('global-football-teams')
@UseGuards(JwtAuthGuard)
export class GlobalFootballTeamsController {
  constructor(private readonly service: GlobalFootballTeamsService) {}

  @Get()
  @ApiOperation({
    summary: 'List real-world football clubs (reference data)',
    description:
      'The list a user picks a supported club from. **Not KickR teams** — ' +
      'those are per-event squads under GET /events/:id/teams. ' +
      'Returns every row in display order (`sortOrder`, then `name` as a ' +
      'tiebreaker), and is deliberately **not paginated**: it is a fixed list ' +
      'of about twenty clubs meant to fill one picker. Read-only — rows are ' +
      'seeded server-side, so there is no create, update or delete.',
  })
  findAll() {
    return this.service.findAll();
  }
}
