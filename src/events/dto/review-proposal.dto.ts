// src/events/dto/review-proposal.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const PROPOSAL_REVIEW_ACTIONS = ['accept', 'reject'] as const;

/**
 * Body for `PATCH /events/:id/proposal/review` — the OTHER side's verdict on
 * a challenge's proposal event. The reason is optional but is what the
 * proposer edits against ("date change need", "color conflict", …).
 */
export class ReviewProposalDto {
  @ApiProperty({ enum: PROPOSAL_REVIEW_ACTIONS, example: 'accept' })
  @IsIn(PROPOSAL_REVIEW_ACTIONS as unknown as string[])
  action: string;

  @ApiPropertyOptional({ example: 'Date change needed — we play league that day' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
