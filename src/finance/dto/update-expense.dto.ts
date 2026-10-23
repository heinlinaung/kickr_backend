// src/finance/dto/update-expense.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateExpenseDto } from './create-expense.dto';

/** Body for `PATCH /events/:eventId/expenses/:expenseId` — any POST field. */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
