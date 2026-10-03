// src/events/dto/submit-payment.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PAYMENT_METHODS } from '../schemas/event-payment.schema';

/**
 * Body for `POST /events/:id/payments` — a member submits THEIR OWN payment
 * for review. Multipart: `method` rides alongside an optional `file` part,
 * which is REQUIRED for bank_transfer (the receipt screenshot) and ignored
 * for cash. No amount — the event owns its price.
 */
export class SubmitPaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS, example: 'bank_transfer' })
  @IsIn(PAYMENT_METHODS as unknown as string[])
  method: string;
}
