import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';

/**
 * A challenge player's answer to their invitation, as shown on
 * `GET /events/:id/players`:
 * - `approved`   — accepted (row `joined`)
 * - `reject`     — declined, or the invitation was withdrawn (row `cancelled`)
 * - `not_submit` — not answered yet (row `invited`)
 */
export const PLAYER_FLAGS = ['approved', 'reject', 'not_submit'] as const;
export type PlayerFlag = (typeof PLAYER_FLAGS)[number];

/** Query for `GET /events/:id/players`. Both filters are challenge-only. */
export class ListPlayersQueryDto {
  @ApiPropertyOptional({
    enum: PLAYER_FLAGS,
    description:
      'Challenge events only. Show only players with this invitation answer. ' +
      'Omit to list every invited player with their `flag`.',
  })
  @IsOptional()
  @IsIn(PLAYER_FLAGS)
  flag?: PlayerFlag;

  @ApiPropertyOptional({
    example: '665f1a2b3c4d5e6f70819200',
    description:
      'Challenge events only. Show only the players of this side (one of the ' +
      'two groups in the challenge).',
  })
  @IsOptional()
  @IsMongoId()
  groupId?: string;
}
