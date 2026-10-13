// src/events/dto/resubmit-proposal.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/**
 * Body for `POST /events/:id/proposal/resubmit` — optional, since the fix
 * may already have been made via PATCH /events/:id.
 *
 * `date` rides along because "date change need" is the archetypal rejection:
 * the proposer fixes the date and resubmits in one call. Any other field
 * still goes through the normal event PATCH first.
 */
export class ResubmitProposalDto {
  @ApiPropertyOptional({ example: '2026-10-27T13:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  date?: string;
}
