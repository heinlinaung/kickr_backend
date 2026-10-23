// src/finance/finance.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FinanceService } from './finance.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { SettleEventDto } from './dto/settle-event.dto';
import { ReopenEventDto } from './dto/reopen-event.dto';
import { UpdateFeeDto } from './dto/update-fee.dto';
import {
  ListFundTransactionsQuery,
  ListGroupExpensesQuery,
  ListOutstandingQuery,
  MyOutstandingQuery,
} from './dto/finance-query.dto';

/**
 * Event Funds (spec 2026-10-19): expenses, settlement and the group fund.
 *
 * Rooted at `/` because it spans `events/…`, `groups/…` and `me/…`. Every
 * route has at least two path segments, so none can shadow the bare
 * `events/:id` / `groups/:id` handlers in the public controllers.
 *
 * Errors carry a machine `code` (NOT_CASHIER, EVENT_SETTLED, …) beside the
 * message. Amounts are 2-place decimal strings in THB.
 */
@ApiTags('Payment & Funds')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  // --- Event -----------------------------------------------------------------

  @Get('events/:eventId/finance')
  @ApiOperation({
    summary: 'Event money summary (group members)',
    description:
      'Totals, expense breakdown and status (OPEN | SETTLED). Income is ' +
      'derived from the roster and approved payments; net = collected − ' +
      'expenses, a preview while OPEN. The per-player list stays in ' +
      'GET /events/:id/payments.',
  })
  getFinance(@Param('eventId') eventId: string, @CurrentUser() user: any) {
    return this.financeService.getEventFinance(eventId, user._id.toString());
  }

  @Get('events/:eventId/expenses')
  @ApiOperation({
    summary: "List an event's expenses (cashier or owner)",
    description:
      'Individual entries with notes. Members see per-category totals in ' +
      'GET /events/:eventId/finance instead — unless the group sets ' +
      '`showExpenseDetailsToMembers: true`, which opens this list to any ' +
      'approved member.',
  })
  @ApiResponse({ status: 403, description: 'NOT_CASHIER, NOT_GROUP_MEMBER' })
  listExpenses(@Param('eventId') eventId: string, @CurrentUser() user: any) {
    return this.financeService.listExpenses(eventId, user._id.toString());
  }

  @Post('events/:eventId/expenses')
  @ApiOperation({
    summary: 'Add an expense (cashier or owner)',
    description:
      'category STADIUM | DRINKS | EQUIPMENT | OTHER (OTHER needs a note); ' +
      'amount a 2-place string > 0. Only while the event is OPEN.',
  })
  @ApiResponse({ status: 400, description: 'INVALID_AMOUNT, NOTE_REQUIRED' })
  @ApiResponse({ status: 403, description: 'NOT_CASHIER' })
  @ApiResponse({ status: 409, description: 'EVENT_SETTLED' })
  createExpense(
    @Param('eventId') eventId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.financeService.createExpense(eventId, user._id.toString(), dto);
  }

  @Patch('events/:eventId/expenses/:expenseId')
  @ApiOperation({ summary: 'Edit an expense (cashier or owner, OPEN only)' })
  @ApiResponse({ status: 404, description: 'EXPENSE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'EVENT_SETTLED' })
  updateExpense(
    @Param('eventId') eventId: string,
    @Param('expenseId') expenseId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.financeService.updateExpense(
      eventId,
      expenseId,
      user._id.toString(),
      dto,
    );
  }

  @Delete('events/:eventId/expenses/:expenseId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an expense (cashier or owner, OPEN only)' })
  @ApiResponse({ status: 404, description: 'EXPENSE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'EVENT_SETTLED' })
  async deleteExpense(
    @Param('eventId') eventId: string,
    @Param('expenseId') expenseId: string,
    @CurrentUser() user: any,
  ) {
    await this.financeService.deleteExpense(
      eventId,
      expenseId,
      user._id.toString(),
    );
  }

  @Patch('events/:eventId/fee')
  @ApiOperation({
    summary: 'Set a new per-player price (cashier or owner, OPEN only)',
    description:
      '`updatedPrice` is the full new price (≥ 0) or null to return to the ' +
      "event's own fee; `reason` is required and every change is kept. " +
      'Members are notified of their new amount.',
  })
  @ApiResponse({ status: 400, description: 'INVALID_AMOUNT, NEGATIVE_PRICE' })
  @ApiResponse({ status: 403, description: 'NOT_CASHIER' })
  @ApiResponse({ status: 409, description: 'EVENT_SETTLED' })
  updateFee(
    @Param('eventId') eventId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateFeeDto,
  ) {
    return this.financeService.updateFee(eventId, user._id.toString(), dto);
  }

  @Post('events/:eventId/settle')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Settle and post net to the group fund (cashier or owner)',
    description:
      'Locks expenses and posts net = collected − expenses (may be ' +
      'negative). The event must have ended; no payment may be waiting for ' +
      'review; if players still owe, allowOutstanding must be true.',
  })
  @ApiResponse({ status: 403, description: 'NOT_CASHIER' })
  @ApiResponse({
    status: 409,
    description:
      'EVENT_SETTLED, EVENT_NOT_FINISHED, PENDING_REVIEWS, OUTSTANDING_PAYMENTS',
  })
  settle(
    @Param('eventId') eventId: string,
    @CurrentUser() user: any,
    @Body() dto: SettleEventDto,
  ) {
    return this.financeService.settle(eventId, user._id.toString(), dto);
  }

  @Post('events/:eventId/reopen')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Undo a settlement (group owner)',
    description:
      'Adds a SETTLEMENT_REVERSAL ledger row (the original stays) and ' +
      'returns the finance summary with status OPEN. Late payments already ' +
      'posted are kept.',
  })
  @ApiResponse({ status: 403, description: 'NOT_GROUP_OWNER' })
  @ApiResponse({ status: 409, description: 'EVENT_NOT_SETTLED' })
  reopen(
    @Param('eventId') eventId: string,
    @CurrentUser() user: any,
    @Body() dto: ReopenEventDto,
  ) {
    return this.financeService.reopen(eventId, user._id.toString(), dto);
  }

  // --- Group -----------------------------------------------------------------

  @Get('groups/:groupId/fund')
  @ApiOperation({
    summary: 'Group fund summary (group members)',
    description:
      'Balance, totals, outstanding across settled events, and the last 5 ' +
      'settled events. Also embedded in GET /groups/:id as `fund`.',
  })
  getFund(@Param('groupId') groupId: string, @CurrentUser() user: any) {
    return this.financeService.getGroupFund(groupId, user._id.toString());
  }

  @Get('groups/:groupId/fund/transactions')
  @ApiOperation({ summary: 'Group fund history, newest first (group members)' })
  listFundTransactions(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Query() query: ListFundTransactionsQuery,
  ) {
    return this.financeService.listFundTransactions(
      groupId,
      user._id.toString(),
      query,
    );
  }

  @Get('groups/:groupId/expenses')
  @ApiOperation({
    summary:
      "Expenses across the group's events, newest first (cashier or owner)",
    description:
      'Individual entries with their event, filterable by category, event ' +
      'and date (`from`/`to` on when the expense was recorded). `total` ' +
      'sums every match, not just the page. Covers open events too; ' +
      '`eventSettled` marks the locked ones. Open to any approved member ' +
      'when the group sets `showExpenseDetailsToMembers: true`.',
  })
  @ApiResponse({ status: 403, description: 'NOT_CASHIER, NOT_GROUP_MEMBER' })
  listGroupExpenses(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Query() query: ListGroupExpensesQuery,
  ) {
    return this.financeService.listGroupExpenses(
      groupId,
      user._id.toString(),
      query,
    );
  }

  @Get('groups/:groupId/outstanding')
  @ApiOperation({
    summary: 'Players who still owe, and for which events (cashier or owner)',
  })
  @ApiResponse({ status: 403, description: 'NOT_CASHIER' })
  listOutstanding(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Query() query: ListOutstandingQuery,
  ) {
    return this.financeService.listGroupOutstanding(
      groupId,
      user._id.toString(),
      query,
    );
  }

  // --- Me --------------------------------------------------------------------

  @Get('me/outstanding')
  @ApiOperation({
    summary: 'Your own unpaid event fees',
    description:
      'Same shape as GET /groups/:id/outstanding with at most one item. ' +
      'Across all your group events, or one group with ?groupId=.',
  })
  listMyOutstanding(
    @CurrentUser() user: any,
    @Query() query: MyOutstandingQuery,
  ) {
    return this.financeService.listMyOutstanding(user._id.toString(), query);
  }
}
