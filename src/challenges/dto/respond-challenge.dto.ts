// src/challenges/dto/respond-challenge.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const CHALLENGE_RESPONSES = ['accept', 'reject'] as const;

/**
 * Body for `PATCH /challenges/:id/respond` — the challenged side's verdict.
 * The reason is OPTIONAL even on rejection (unlike payment reviews): "no"
 * is a complete answer to an unsolicited challenge.
 */
export class RespondChallengeDto {
  @ApiProperty({ enum: CHALLENGE_RESPONSES, example: 'accept' })
  @IsIn(CHALLENGE_RESPONSES as unknown as string[])
  action: string;

  @ApiPropertyOptional({ example: 'Our squad is away that month' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
