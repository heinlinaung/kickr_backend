// src/groups/dto/update-payment-details.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `PUT /groups/:id/payment-details` — cashier only.
 *
 * The account members transfer to. The QR image has its own multipart
 * endpoint (`PUT /groups/:id/payment-details/qr`) and survives this update.
 */
export class UpdatePaymentDetailsDto {
  @ApiProperty({ example: '0123456789' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  bankAccountNumber: string;

  @ApiPropertyOptional({ example: 'KBZ Bank' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: 'U Hein Lin Aung' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountHolderName?: string;
}
