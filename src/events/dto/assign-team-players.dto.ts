// src/events/dto/assign-team-players.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `PATCH /events/:id/teams/:teamId`.
 *
 * Replaces the team's roster outright — the client has already shuffled and
 * possibly hand-edited, so a partial patch would just invite drift between the
 * two sides. `name` is optional so a team can be renamed in the same call.
 */
export class AssignTeamPlayersDto {
  @ApiProperty({
    example: ['665f1a2b3c4d5e6f70819200'],
    description:
      'The team\'s full roster. Replaces whatever was there. Each id must be ' +
      'a joined player on this event, and no player may sit in two teams.',
  })
  @IsArray()
  @IsMongoId({ each: true })
  playerIds: string[];

  @ApiProperty({ example: 'Red', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;
}
