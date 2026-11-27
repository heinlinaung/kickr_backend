// src/events/dto/review-proposal.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const PROPOSAL_REVIEW_ACTIONS = ['accept', 'reject'] as const;

/**
 * Body for `PATCH /events/:id/proposal/review` — the OTHER side's verdict on
 * a challenge's proposal event. The reason is optional but is what the
 * proposer edits against ("date change need", "color conflict", …).
 *
 * On reject the reviewer may also counter-suggest a venue (`locationId`) and
 * kick-off (`datetime`). They are stored as suggestions on the event — the
 * event's own `locationId`/`date` are untouched until the proposer edits and
 * resubmits. Ignored on accept.
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

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Reject only — the venue the reviewing side suggests instead',
  })
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @ApiPropertyOptional({
    example: '2026-10-27T13:00:00.000Z',
    description: 'Reject only — the date/time the reviewing side suggests instead',
  })
  @IsOptional()
  @IsDateString()
  datetime?: string;
}
