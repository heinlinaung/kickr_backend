// src/finance/dto/update-fee.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Allow, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `PATCH /events/:eventId/fee`.
 *
 * `updatedPrice` is the FULL new price per player (not a top-up), or null to
 * go back to the event's own fee. Format-checked in the service, like
 * expense amounts, so failures carry INVALID_AMOUNT / NEGATIVE_PRICE.
 */
export class UpdateFeeDto {
  @ApiProperty({ example: '150.00', nullable: true })
  @Allow()
  updatedPrice: string | null;

  @ApiProperty({ example: 'Only 16 players came' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
