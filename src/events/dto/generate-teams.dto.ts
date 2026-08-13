// src/events/dto/generate-teams.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_TEAMS, MIN_TEAMS } from '../events.fixtures';

/**
 * Body for `POST /events/:id/teams/generate`.
 *
 * Creates the teams EMPTY and derives the fixture list from the event's
 * duration. Players are assigned afterwards via
 * `PATCH /events/:id/teams/:teamId` — the client shuffles locally and may
 * hand-edit, so assignment is deliberately a separate step.
 */
export class GenerateTeamsDto {
  @ApiProperty({
    example: 3,
    minimum: MIN_TEAMS,
    maximum: MAX_TEAMS,
    description: 'How many teams to create. Named from the colour vocabulary.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_TEAMS)
  @Max(MAX_TEAMS)
  teamsCount: number;

  @ApiProperty({
    example: 30,
    minimum: 1,
    description:
      'Minutes each match lasts. The match count is ' +
      'floor((event.duration - 10) / duration), so the schedule cannot ' +
      'overrun the booked slot.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  duration: number;
}
