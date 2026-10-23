import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PAYMENT_METHODS } from '../../events/schemas/event-payment.schema';
import { AddUsersDto } from './add-users.dto';

/** Body for `POST /admin/events/:eventId/payment` — mark players as paid. */
export class MarkPaymentsPaidDto extends AddUsersDto {
  @ApiPropertyOptional({
    enum: PAYMENT_METHODS,
    default: 'cash',
    description: 'Method recorded on the payment rows. No receipt is stored.',
  })
  @IsOptional()
  @IsIn(PAYMENT_METHODS as unknown as string[])
  method?: string;
}
