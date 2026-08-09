// src/events/dto/submit-teams.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_TEAMS, MIN_TEAMS } from '../events.fixtures';

export class SubmittedTeamDto {
  @ApiProperty({ example: 'Red', description: 'Team name; keys fixtures and chats' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name: string;

  @ApiProperty({
    example: ['665f1a2b3c4d5e6f70819200'],
    description: 'Joined players on this team. May be empty.',
  })
  @IsArray()
  @IsMongoId({ each: true })
  playerIds: string[];
}

/**
 * Body for `PUT /events/:id/teams` (spec §4.3.1).
 *
 * Shape only. The semantic rules — ids must be joined players, no player in two
 * teams, names unique — need the event's roster to check, so they live in
 * `events.teams.ts` and run in the service, where the error can name the
 * offending id.
 */
export class SubmitTeamsDto {
  @ApiProperty({ type: [SubmittedTeamDto] })
  @IsArray()
  @ArrayMinSize(MIN_TEAMS)
  @ArrayMaxSize(MAX_TEAMS)
  @ValidateNested({ each: true })
  @Type(() => SubmittedTeamDto)
  teams: SubmittedTeamDto[];
}
