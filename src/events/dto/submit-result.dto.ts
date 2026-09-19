// src/events/dto/submit-result.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Body for `POST /events/:id/result` (spec §4.4).
 *
 * `mvpUserId` moved to its own endpoint on 2026-09-19 — `POST
 * /events/:id/mvp` (SubmitMvpDto) — so this body is score-only now, and a
 * client still sending an MVP here gets a 400 from the global
 * forbidNonWhitelisted pipe rather than a silent drop.
 *
 * `scoreA`/`scoreB` are for simple 2-team events that never generated
 * fixtures; multi-team events derive everything from `matches[]` instead
 * (decision #4), so they are optional here rather than required.
 */
export class SubmitResultDto {
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
