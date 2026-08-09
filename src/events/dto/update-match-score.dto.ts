// src/events/dto/update-match-score.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Body for `PATCH /events/:id/matches/:matchNumber`.
 *
 * Both scores are required: a fixture is either played (two numbers) or
 * unplayed (two nulls). Allowing one side would create a half-scored row that
 * standings would have to guess at.
 *
 * 0 is valid and meaningful — a goalless draw. The `null` that marks a fixture
 * unplayed is set at generation time and never sent by a client.
 */
export class UpdateMatchScoreDto {
  @ApiProperty({ example: 3, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(200)
  scoreA: number;

  @ApiProperty({ example: 2, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(200)
  scoreB: number;
}
