// src/events/dto/generate-matches.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Body for `POST /events/:id/matches/generate`.
 *
 * Only the per-match duration: the teams already exist (from
 * `POST /events/:id/teams/generate`), and the number of matches is derived
 * from the event's total duration.
 */
export class GenerateMatchesDto {
  @ApiProperty({
    example: 10,
    minimum: 1,
    description:
      'Minutes each match lasts. The match count is ' +
      'floor((event.duration - 10) / duration), so the schedule never ' +
      'overruns the booked slot.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  duration: number;
}
