// src/finance/dto/finance-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';
import { FUND_TRANSACTION_TYPES } from '../schemas/group-fund-transaction.schema';
import { EXPENSE_CATEGORIES } from '../schemas/event-expense.schema';

/** Query for `GET /groups/:groupId/fund/transactions`. */
export class ListFundTransactionsQuery {
  @ApiPropertyOptional({ enum: FUND_TRANSACTION_TYPES })
  @IsOptional()
  @IsIn(FUND_TRANSACTION_TYPES as unknown as string[])
  type?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

/** Query for `GET /groups/:groupId/outstanding` (and `GET /me/outstanding`). */
export class ListOutstandingQuery {
  @ApiPropertyOptional({ description: 'One player only' })
  @IsOptional()
  @IsMongoId()
  memberId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includePending?: boolean;

  @ApiPropertyOptional({ enum: ['all', 'settled'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'settled'])
  eventStatus?: 'all' | 'settled';

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

/** Query for `GET /me/outstanding`: the group filter is optional there. */
export class MyOutstandingQuery extends ListOutstandingQuery {
  @ApiPropertyOptional({ description: 'Only this group' })
  @IsOptional()
  @IsMongoId()
  groupId?: string;
}

/** Query for `GET /groups/:groupId/expenses`. */
export class ListGroupExpensesQuery {
  @ApiPropertyOptional({ enum: EXPENSE_CATEGORIES })
  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ description: 'One event only' })
  @IsOptional()
  @IsMongoId()
  eventId?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

