// src/finance/schemas/event-expense.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventExpenseDocument = HydratedDocument<EventExpense>;

export const EXPENSE_CATEGORIES = [
  'STADIUM',
  'DRINKS',
  'EQUIPMENT',
  'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_PAID_METHODS = ['CASH', 'BANK_TRANSFER'] as const;

/**
 * One cost the cashier paid for an event (stadium, drinks, …).
 *
 * Editable only while the event's settlement is OPEN; settling snapshots the
 * total and locks these rows. Deletion is SOFT (`deletedAt`) so the audit
 * trail survives — every read filters `deletedAt: null`.
 */
@Schema({ timestamps: true })
export class EventExpense {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event', index: true })
  eventId: Types.ObjectId;

  @Prop({ required: true, enum: EXPENSE_CATEGORIES })
  category: string;

  /** Baht, > 0. Validated as a 2-place string at the API edge. */
  @Prop({ required: true, min: 0.01 })
  amount: number;

  /** Required when category is OTHER — "other" alone says nothing. */
  @Prop({ type: String, default: null })
  note: string | null;

  @Prop({ type: String, enum: [...EXPENSE_PAID_METHODS, null], default: null })
  paidMethod: string | null;

  @Prop({ type: String, default: null })
  receiptUrl: string | null;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy: Types.ObjectId | null;
}

export const EventExpenseSchema = SchemaFactory.createForClass(EventExpense);
