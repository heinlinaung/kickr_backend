// src/events/dto/review-payment.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const REVIEW_ACTIONS = ['approve', 'reject'] as const;

/**
 * Body for `PATCH /events/:id/payments/:memberId/review` — the cashier's
 * verdict on a submission. A rejection must say why: the reason is what the
 * member sees, and a bare "rejected" gives them nothing to fix.
 */
export class ReviewPaymentDto {
  @ApiProperty({ enum: REVIEW_ACTIONS, example: 'approve' })
  @IsIn(REVIEW_ACTIONS as unknown as string[])
  action: string;

  @ApiPropertyOptional({
    example: 'Transfer amount does not match the event price',
    description: 'Required when rejecting; ignored on approval.',
  })
  @ValidateIf((dto: ReviewPaymentDto) => dto.action === 'reject')
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
