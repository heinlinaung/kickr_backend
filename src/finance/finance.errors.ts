// src/finance/finance.errors.ts
/**
 * Event Funds error responses. Each carries a machine `code` beside the
 * human `message`; HttpExceptionFilter spreads the object into the body, so
 * clients branch on `code` and show `message`.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export const notCashier = () =>
  new ForbiddenException({
    code: 'NOT_CASHIER',
    message: "Only the group's cashier or owner can manage event funds",
  });

export const notGroupOwner = () =>
  new ForbiddenException({
    code: 'NOT_GROUP_OWNER',
    message: 'Only the group owner can reopen a settled event',
  });

export const notGroupMember = () =>
  new ForbiddenException({
    code: 'NOT_GROUP_MEMBER',
    message: 'Only members of this group can view its funds',
  });

export const notGroupEvent = () =>
  new BadRequestException({
    code: 'NOT_GROUP_EVENT',
    message: 'Event funds are only available for group events',
  });

export const expenseNotFound = () =>
  new NotFoundException({
    code: 'EXPENSE_NOT_FOUND',
    message: 'Expense not found',
  });

export const eventSettled = () =>
  new ConflictException({
    code: 'EVENT_SETTLED',
    message: 'This event is settled — reopen it first',
  });

export const eventNotSettled = () =>
  new ConflictException({
    code: 'EVENT_NOT_SETTLED',
    message: 'This event is not settled',
  });

export const eventNotFinished = () =>
  new ConflictException({
    code: 'EVENT_NOT_FINISHED',
    message: 'An event can only be settled after it has ended',
  });

export const pendingReviews = (count: number) =>
  new ConflictException({
    code: 'PENDING_REVIEWS',
    message: `${count} payment(s) are still waiting for review — approve or reject them first`,
    pendingReviewCount: count,
  });

export const outstandingPayments = (
  outstanding: string,
  owing: Array<{
    member: { id: string; name: string | null };
    amount: string;
    status: string;
  }>,
) =>
  new ConflictException({
    code: 'OUTSTANDING_PAYMENTS',
    message:
      'Players still owe money — pass allowOutstanding: true to settle anyway',
    outstanding,
    owing,
  });

export const negativePrice = () =>
  new BadRequestException({
    code: 'NEGATIVE_PRICE',
    message: 'updatedPrice must be 0 or more',
  });

export const otherNeedsNote = () =>
  new BadRequestException({
    code: 'NOTE_REQUIRED',
    message: 'A note is required for an OTHER expense',
  });
