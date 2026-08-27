// src/events/dto/generate-teams.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
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

  @ApiProperty({
    example: 5,
    minimum: 1,
    description:
      'Intended squad size per team. A target for the client to show ' +
      'progress against, not a constraint — assigning players is a separate ' +
      'step and is not validated against it.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  numberOfPlayers: number;

  /**
   * Team names, supplied by the client.
   *
   * Spelling is NOT validated — any label is accepted, so a client is free to
   * send names that are not colours at all. Two things ARE checked, in the
   * service where `teamsCount` is also in scope:
   *  - the count must equal `teamsCount`, otherwise it is ambiguous how many
   *    teams to create and what to call them;
   *  - they must be distinct (case-insensitively), because a team name keys
   *    both the fixture list and the team chat room, so two teams sharing one
   *    makes both ambiguous.
   *
   * Optional. Omitted, the built-in colour vocabulary is used in order, which
   * is what every existing caller relies on.
   */
  @ApiPropertyOptional({
    example: ['red', 'blue', 'white'],
    type: [String],
    description:
      'Team names, one per team — length must equal teamsCount, and they ' +
      'must be distinct. Spelling is not validated. Omit to use the ' +
      'built-in colour vocabulary.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(MIN_TEAMS)
  @ArrayMaxSize(MAX_TEAMS)
  @IsString({ each: true })
  colors?: string[];
}
