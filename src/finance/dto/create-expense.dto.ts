// src/finance/dto/create-expense.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAID_METHODS,
} from '../schemas/event-expense.schema';

/**
 * Body for `POST /events/:eventId/expenses`.
 *
 * `amount` carries only `@Allow()`: its format is checked in the service so a
 * bad value answers with the `INVALID_AMOUNT` code the client keys on, not a
 * generic validation array. The OTHER-needs-a-note rule is enforced there
 * too, because PATCH has to apply it against the stored category.
 */
export class CreateExpenseDto {
  @ApiProperty({ enum: EXPENSE_CATEGORIES, example: 'STADIUM' })
  @IsIn(EXPENSE_CATEGORIES as unknown as string[])
  category: string;

  @ApiProperty({
    example: '1800.00',
    description: '2-place decimal string, > 0',
  })
  @Allow()
  amount: string;

  @ApiPropertyOptional({
    example: 'Court 2, 2 hours',
    description: 'Required when category is OTHER.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ enum: EXPENSE_PAID_METHODS, nullable: true })
  @IsOptional()
  @IsIn(EXPENSE_PAID_METHODS as unknown as string[])
  paidMethod?: string | null;

  @ApiPropertyOptional({
    example: 'https://ik.imagekit.io/…/receipt.jpg',
    nullable: true,
  })
  @IsOptional()
  @IsUrl()
  receiptUrl?: string | null;
}
