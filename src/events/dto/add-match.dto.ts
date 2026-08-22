// src/events/dto/add-match.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /events/:id/matches` — add one fixture by hand.
 *
 * `matchNumber` is deliberately NOT accepted: it carries a unique index per
 * event, so letting the caller pick one invites a duplicate-key error on a
 * value they cannot see. The server appends after the current highest.
 *
 * Scores are not accepted either. A fixture is created unplayed and scored
 * through `PATCH /events/:id/matches/:matchNumber`, the same as a generated
 * one — otherwise there would be two ways to write a result.
 */
export class AddMatchDto {
  @ApiProperty({
    example: 'Blue',
    description:
      'Home team name. Must be one of the event\'s teams — the name keys the ' +
      'fixture, so a typo would create a match no team can be matched to.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  teamA: string;

  @ApiProperty({ example: 'Red', description: 'Away team name.' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  teamB: string;
}
