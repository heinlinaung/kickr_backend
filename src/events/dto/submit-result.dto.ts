// src/events/dto/submit-result.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

/**
 * Body for `POST /events/:id/result` (spec §4.4).
 *
 * `mvpUserId` must be a joined player — checked in the service, which has the
 * roster. `scoreA`/`scoreB` are for simple 2-team events that never generated
 * fixtures; multi-team events derive everything from `matches[]` instead
 * (decision #4), so they are optional here rather than required.
 */
export class SubmitResultDto {
  @ApiProperty({ example: '665f1a2b3c4d5e6f70819200', required: false })
  @IsOptional()
  @IsMongoId()
  mvpUserId?: string;

  @ApiProperty({ example: 3, required: false, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  scoreA?: number;

  @ApiProperty({ example: 2, required: false, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  scoreB?: number;
}
