// src/events/dto/assign-team-players.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  /**
   * Approved GUESTS for this team, by their **roster-row id** — the `_id` from
   * `GET /events/:id/guests`, not a user id, because a guest has no account.
   *
   * Optional and replaces outright, exactly like `playerIds`. Omitting it
   * clears the team's guests rather than leaving them, so one call fully
   * describes the squad and a stale client cannot silently preserve a guest it
   * did not mean to keep.
   */
  @ApiPropertyOptional({
    example: ['6a955e51d06a895ae553ed68'],
    type: [String],
    description:
      "The team's guests, by roster-row id from GET /events/:id/guests. " +
      'Must be approved guests on this event. Replaces outright — omit to ' +
      'clear them.',
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  guestIds?: string[];

  @ApiProperty({ example: 'Red', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;
}
