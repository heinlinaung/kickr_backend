// src/challenges/dto/cancel-challenge.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST /challenges/:id/cancel`. The reason is OPTIONAL, same as on
 * a rejection — it is passed on to the other group's admins when given.
 */
export class CancelChallengeDto {
  @ApiPropertyOptional({
    example: 'Half our squad is injured — we will challenge you again later',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
