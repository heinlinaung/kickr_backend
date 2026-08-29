import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Body for `PATCH /events/:id/payments/:memberId`. */
export class SetPaymentDto {
  @ApiProperty({
    example: true,
    description:
      'true marks the member paid, false reverses it. The amount is not sent ' +
      'here — it comes from the event (`price`, plus `additionalPrice` when ' +
      '`takeAdditionalPrice` is set), so there is one source of truth for ' +
      'what the event costs.',
  })
  @IsBoolean()
  isPaid: boolean;
}
