// src/finance/finance.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Event, EventDocument } from '../events/schemas/event.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from '../events/schemas/event-player.schema';
import {
  EventPayment,
  EventPaymentDocument,
} from '../events/schemas/event-payment.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  keysetFilter,
} from '../common/pagination/cursor';
import {
  EXPENSE_CATEGORIES,
  EventExpense,
  EventExpenseDocument,
} from './schemas/event-expense.schema';
import {
  EventSettlement,
  EventSettlementDocument,
} from './schemas/event-settlement.schema';
import { GroupFund, GroupFundDocument } from './schemas/group-fund.schema';
import {
  FundTransactionType,
  GroupFundTransaction,
  GroupFundTransactionDocument,
} from './schemas/group-fund-transaction.schema';
import {
  EventFeeAdjustment,
  EventFeeAdjustmentDocument,
} from './schemas/event-fee-adjustment.schema';
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
import {
  CURRENCY,
  MemberBalanceStatus,
  PaymentLike,
  feePerPlayerCents,
  formatBaht,
  formatCents,
  fromCents,
  memberBalance,
  paidCents,
  parseAmount,
  pricePerPlayerCents,
  toCents,
} from './money';
import {
  eventNotFinished,
  eventNotSettled,
  eventSettled,
  expenseNotFound,
  negativePrice,
  notCashier,
  notGroupEvent,
  notGroupMember,
  notGroupOwner,
  otherNeedsNote,
  outstandingPayments,
  pendingReviews,
} from './finance.errors';

/** Lifecycle states in which an event has been played out. */
const ENDED_STATUSES = ['after_match', 'done'];

/** How many settled events the group summary lists. */
const RECENT_EVENTS = 5;

type GroupEvent = Pick<
  Event,
  | 'title'
  | 'date'
  | 'status'
  | 'endTime'
  | 'createdBy'
  | 'price'
  | 'additionalPrice'
  | 'takeAdditionalPrice'
  | 'updatedPrice'
> & { _id: Types.ObjectId; groupId: Types.ObjectId };

const EVENT_FIELDS =
  '_id title date status endTime groupId createdBy price additionalPrice ' +
  'takeAdditionalPrice updatedPrice';

/** One member's standing on one event, with display data attached. */
interface MemberLine {
  memberId: string;
  name: string | null;
  status: MemberBalanceStatus;
  owedCents: number;
  creditCents: number;
}

interface IncomeFigures {
  feeCents: number;
  priceCents: number;
  players: number;
  expectedCents: number;
  collectedCents: number;
  outstandingCents: number;
  creditCents: number;
  unpaidCount: number;
  pendingReviewCount: number;
  overpaidCount: number;
  members: MemberLine[];
}

/**
 * Event Funds: expenses, settlement and the group fund ledger, on top of the
 * existing submit/review payment flow (spec: Event Funds, 2026-10-19).
 *
 * Income is never entered — it is derived on every read from the roster and
 * the payment rows (see `money.ts#memberBalance`). The cashier enters only
 * expenses; settling snapshots both and posts the net to the group's ledger.
 *
 * Group events only: the fund belongs to a group, and a standalone event has
 * none to post into.
 */
@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  /** Set once the server proves to be a standalone mongod (no transactions). */
  private transactionsUnsupported = false;

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(EventPayment.name)
    private paymentModel: Model<EventPaymentDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    @InjectModel(EventExpense.name)
    private expenseModel: Model<EventExpenseDocument>,
    @InjectModel(EventSettlement.name)
    private settlementModel: Model<EventSettlementDocument>,
    @InjectModel(GroupFund.name) private fundModel: Model<GroupFundDocument>,
    @InjectModel(GroupFundTransaction.name)
    private fundTxModel: Model<GroupFundTransactionDocument>,
    @InjectModel(EventFeeAdjustment.name)
    private feeAdjustmentModel: Model<EventFeeAdjustmentDocument>,
    private notificationsService: NotificationsService,
  ) {}

  // --- Plumbing --------------------------------------------------------------

  /**
   * Runs `fn` in a MongoDB transaction, so a settlement, its ledger row and
   * the fund balance land together or not at all. `withTransaction` retries
   * on write conflicts, which is how two cashiers posting at once resolve.
   *
   * A standalone mongod (local dev) cannot run transactions; there the work
   * runs unsessioned, once, with a warning. Production is Atlas, a replica
   * set, so this fallback never triggers there.
   */
  async runInTransaction<T>(
    fn: (session: ClientSession | null) => Promise<T>,
  ): Promise<T> {
    if (this.transactionsUnsupported) return fn(null);
    const session = await this.connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } catch (err) {
      if (isTransactionUnsupported(err)) {
        this.transactionsUnsupported = true;
        this.logger.warn(
          'MongoDB does not support transactions here (standalone server); ' +
            'event funds will post without atomicity',
        );
        return fn(null);
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  private async loadGroupEvent(
    eventId: string,
    session: ClientSession | null = null,
  ): Promise<GroupEvent> {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new NotFoundException('Event not found');
    }
    const event = await this.eventModel
      .findById(eventId)
      .select(EVENT_FIELDS)
      .session(session)
      .lean();
    if (!event) throw new NotFoundException('Event not found');
    if (!event.groupId) throw notGroupEvent();
    return event as unknown as GroupEvent;
  }

  private async loadGroup(groupId: Types.ObjectId | string) {
    const group = await this.groupModel
      .findById(groupId)
      .select('ownerId cashierId showExpenseDetailsToMembers')
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  /** Writes: the group's cashier, or its owner. */
  private async assertCashierOrOwner(
    groupId: Types.ObjectId | string,
    userId: string,
  ) {
    const group = await this.loadGroup(groupId);
    const isOwner = group.ownerId?.toString() === userId;
    const isCashier = group.cashierId?.toString() === userId;
    if (!isOwner && !isCashier) throw notCashier();
    return group;
  }

  private async assertOwner(groupId: Types.ObjectId | string, userId: string) {
    const group = await this.loadGroup(groupId);
    if (group.ownerId?.toString() !== userId) throw notGroupOwner();
  }

  /** Reads of summaries: any approved member (cashier and owner included). */
  private async assertCanRead(
    groupId: Types.ObjectId | string,
    userId: string,
  ) {
    if (await this.canRead(groupId, userId)) return;
    throw notGroupMember();
  }

  async canRead(
    groupId: Types.ObjectId | string,
    userId: string | undefined,
  ): Promise<boolean> {
    if (!userId) return false;
    const group = await this.loadGroup(groupId);
    if (
      group.ownerId?.toString() === userId ||
      group.cashierId?.toString() === userId
    ) {
      return true;
    }
    const member = await this.memberModel
      .findOne({
        groupId: new Types.ObjectId(groupId.toString()),
        userId: new Types.ObjectId(userId),
        status: 'approved',
      })
      .select('_id')
      .lean();
    return !!member;
  }

  /**
   * "The event has ended": it reached `after_match`/`done`, or its booked
   * end time has passed. Cancelled events never qualify.
   */
  private isEnded(event: Pick<Event, 'status' | 'endTime'>): boolean {
    if (event.status === 'cancelled') return false;
    if (ENDED_STATUSES.includes(event.status)) return true;
    return !!event.endTime && new Date(event.endTime).getTime() <= Date.now();
  }

  /**
   * Touches the event's settlement row inside `session` (creating it OPEN on
   * first use) and returns it. Every write that must not race a settle —
   * expenses, fee changes, settle/reopen, late-payment posting — goes
   * through here first, so concurrent ones conflict on this document.
   */
  private async lockSettlement(
    event: GroupEvent,
    session: ClientSession | null,
  ): Promise<EventSettlementDocument> {
    const row = await this.settlementModel.findOneAndUpdate(
      { eventId: event._id },
      {
        $inc: { revision: 1 },
        $setOnInsert: { groupId: event.groupId, status: 'OPEN' },
      },
      { returnDocument: 'after', upsert: true, session },
    );
    return row!;
  }

  /**
   * Atomically flips the settlement from `from` to `to`, provided nobody
   * has touched it since `row` was read (same `revision`). Returns the
   * updated row, or null when the claim was lost.
   *
   * Inside a transaction this is belt and braces — the write conflict on
   * `lockSettlement` already serialises. Without one (standalone dev
   * server) it is what keeps "settle twice never posts twice" true.
   */
  private async claimSettlement(
    row: EventSettlementDocument,
    from: 'OPEN' | 'SETTLED',
    to: 'OPEN' | 'SETTLED',
    session: ClientSession | null,
  ) {
    return this.settlementModel.findOneAndUpdate(
      { _id: row._id, status: from, revision: row.revision },
      { $set: { status: to }, $inc: { revision: 1 } },
      { returnDocument: 'after', session },
    );
  }

  /**
   * Appends one ledger row and moves the cached fund totals with it.
   *
   * The fund document is written FIRST: it is the group-wide lock, and its
   * post-`$inc` balance is the new row's `balanceAfter`. `incomeDelta` /
   * `expenseDelta` keep totals.income − totals.expenses equal to the
   * balance.
   */
  private async postFundTransaction(
    session: ClientSession | null,
    entry: {
      groupId: Types.ObjectId;
      eventId: Types.ObjectId | null;
      type: FundTransactionType;
      amountCents: number;
      incomeDeltaCents: number;
      expenseDeltaCents: number;
      note?: string | null;
      memberId?: string | null;
      createdBy: string;
    },
  ) {
    const fund = await this.fundModel.findOneAndUpdate(
      { groupId: entry.groupId },
      {
        $inc: {
          balance: fromCents(entry.amountCents),
          totalIncome: fromCents(entry.incomeDeltaCents),
          totalExpenses: fromCents(entry.expenseDeltaCents),
        },
      },
      { returnDocument: 'after', upsert: true, session },
    );
    // Re-round: $inc on baht Numbers can leave float dust (5480.000000001).
    const balanceAfter = fromCents(toCents(fund!.balance));
    const [tx] = await this.fundTxModel.create(
      [
        {
          groupId: entry.groupId,
          eventId: entry.eventId,
          type: entry.type,
          amount: fromCents(entry.amountCents),
          balanceAfter,
          note: entry.note ?? null,
          memberId: entry.memberId ? new Types.ObjectId(entry.memberId) : null,
          createdBy: new Types.ObjectId(entry.createdBy),
        },
      ],
      { session },
    );
    return { tx, balanceAfterCents: toCents(balanceAfter) };
  }

  /** Sum of every ledger row already posted for an event, in satang. */
  private async eventContributionCents(
    eventId: Types.ObjectId,
    session: ClientSession | null,
  ): Promise<number> {
    const rows = await this.fundTxModel
      .find({ eventId })
      .select('amount')
      .session(session)
      .lean();
    return rows.reduce((sum, row) => sum + toCents(row.amount), 0);
  }

  // --- Derived figures -------------------------------------------------------

  /**
   * Income for one event, derived from the roster and payment rows.
   *
   * Players are registered members on the roster (`joined`, with a user);
   * guests are covered by their sponsor and anonymous players have no
   * account to pay from, so neither is billed. `collected` counts every
   * approved payment, including one from a member who has since left —
   * that money was received.
   */
  private async computeIncome(
    event: GroupEvent,
    session: ClientSession | null = null,
  ): Promise<IncomeFigures> {
    const [players, payments] = await Promise.all([
      this.playerModel
        .find({
          eventId: event._id,
          status: 'joined',
          userId: { $exists: true, $ne: null },
        })
        .populate('userId', 'name username displayName')
        .select('userId')
        .session(session)
        .lean(),
      this.paymentModel
        .find({ eventId: event._id })
        .select('memberId status amount paidAmount')
        .session(session)
        .lean(),
    ]);

    const feeCents = feePerPlayerCents(event);
    const priceCents = pricePerPlayerCents(event);
    const byMember = new Map<string, PaymentLike>(
      payments.map((p) => [p.memberId.toString(), p as PaymentLike]),
    );

    const collectedCents = payments.reduce(
      (sum, p) => sum + paidCents(p as PaymentLike, feeCents),
      0,
    );
    const pendingReviewCount = payments.filter(
      (p) => p.status === 'submitted',
    ).length;

    const members: MemberLine[] = players.map((player) => {
      const user = player.userId as unknown as {
        _id: Types.ObjectId;
        name?: string;
        displayName?: string;
        username?: string;
      } | null;
      const memberId = (user?._id ?? player.userId)!.toString();
      const balance = memberBalance(
        byMember.get(memberId),
        priceCents,
        feeCents,
      );
      return {
        memberId,
        name: displayName(user),
        status: balance.status,
        owedCents: balance.owedCents,
        creditCents: balance.creditCents,
      };
    });

    return {
      feeCents,
      priceCents,
      players: members.length,
      expectedCents: members.length * priceCents,
      collectedCents,
      outstandingCents: members.reduce((sum, m) => sum + m.owedCents, 0),
      creditCents: members.reduce((sum, m) => sum + m.creditCents, 0),
      unpaidCount: members.filter(
        (m) => m.status === 'UNPAID' || m.status === 'PARTIAL',
      ).length,
      pendingReviewCount,
      overpaidCount: members.filter((m) => m.status === 'OVERPAID').length,
      members,
    };
  }

  private async expenseBreakdown(
    eventId: Types.ObjectId,
    session: ClientSession | null = null,
  ) {
    const rows = await this.expenseModel
      .find({ eventId, deletedAt: null })
      .select('category amount')
      .session(session)
      .lean();
    const byCategory = new Map<string, number>();
    for (const row of rows) {
      byCategory.set(
        row.category,
        (byCategory.get(row.category) ?? 0) + toCents(row.amount),
      );
    }
    const totalCents = [...byCategory.values()].reduce((a, b) => a + b, 0);
    return {
      totalCents,
      byCategory: EXPENSE_CATEGORIES.filter((c) => byCategory.has(c)).map(
        (category) => ({
          category,
          amount: formatCents(byCategory.get(category)!),
        }),
      ),
    };
  }

  // --- Event finance summary -------------------------------------------------

  async getEventFinance(eventId: string, userId: string) {
    const event = await this.loadGroupEvent(eventId);
    await this.assertCanRead(event.groupId, userId);
    return this.buildEventFinance(event);
  }

  private async buildEventFinance(event: GroupEvent) {
    const [income, expenses, settlement] = await Promise.all([
      this.computeIncome(event),
      this.expenseBreakdown(event._id),
      this.settlementModel.findOne({ eventId: event._id }).lean(),
    ]);
    const settled = settlement?.status === 'SETTLED';
    return {
      eventId: event._id.toString(),
      currency: CURRENCY,
      status: settled ? 'SETTLED' : 'OPEN',
      income: {
        feePerPlayer: formatCents(income.feeCents),
        updatedPrice:
          event.updatedPrice != null ? formatBaht(event.updatedPrice) : null,
        pricePerPlayer: formatCents(income.priceCents),
        players: income.players,
        expected: formatCents(income.expectedCents),
        collected: formatCents(income.collectedCents),
        outstanding: formatCents(income.outstandingCents),
        unpaidCount: income.unpaidCount,
        pendingReviewCount: income.pendingReviewCount,
        overpaidCount: income.overpaidCount,
        creditOwed: formatCents(income.creditCents),
      },
      expenses: {
        total: formatCents(expenses.totalCents),
        byCategory: expenses.byCategory,
      },
      // While OPEN this is a preview; once SETTLED it is what was posted
      // (plus any late payments since).
      net: formatCents(income.collectedCents - expenses.totalCents),
      settledAt: settled ? (settlement?.settledAt ?? null) : null,
      settledBy: settled ? (settlement?.settledBy ?? null) : null,
    };
  }

  // --- Expenses --------------------------------------------------------------

  /**
   * Line items stay with the cashier and owner — members see per-category
   * totals in the finance summary — unless the group turned on
   * `showExpenseDetailsToMembers`.
   */
  async listExpenses(eventId: string, userId: string) {
    const event = await this.loadGroupEvent(eventId);
    const group = await this.loadGroup(event.groupId);
    if (group.showExpenseDetailsToMembers) {
      await this.assertCanRead(event.groupId, userId);
    } else {
      await this.assertCashierOrOwner(event.groupId, userId);
    }
    const rows = await this.expenseModel
      .find({ eventId: event._id, deletedAt: null })
      .sort({ createdAt: 1 })
      .lean();
    return rows.map(formatExpense);
  }

  async createExpense(eventId: string, userId: string, dto: CreateExpenseDto) {
    const event = await this.loadGroupEvent(eventId);
    await this.assertCashierOrOwner(event.groupId, userId);
    const amountCents = parseAmount(dto.amount);
    const note = dto.note?.trim() || null;
    if (dto.category === 'OTHER' && !note) throw otherNeedsNote();

    const row = await this.runInTransaction(async (session) => {
      const settlement = await this.lockSettlement(event, session);
      if (settlement.status === 'SETTLED') throw eventSettled();
      const [created] = await this.expenseModel.create(
        [
          {
            eventId: event._id,
            category: dto.category,
            amount: fromCents(amountCents),
            note,
            paidMethod: dto.paidMethod ?? null,
            receiptUrl: dto.receiptUrl ?? null,
            createdBy: new Types.ObjectId(userId),
          },
        ],
        { session },
      );
      return created;
    });
    return formatExpense(row.toObject());
  }

  async updateExpense(
    eventId: string,
    expenseId: string,
    userId: string,
    dto: UpdateExpenseDto,
  ) {
    const event = await this.loadGroupEvent(eventId);
    await this.assertCashierOrOwner(event.groupId, userId);
    if (!Types.ObjectId.isValid(expenseId)) throw expenseNotFound();

    const set: Record<string, unknown> = {
      updatedBy: new Types.ObjectId(userId),
    };
    if (dto.amount !== undefined)
      set.amount = fromCents(parseAmount(dto.amount));
    if (dto.category !== undefined) set.category = dto.category;
    if (dto.note !== undefined) set.note = dto.note?.trim() || null;
    if (dto.paidMethod !== undefined) set.paidMethod = dto.paidMethod ?? null;
    if (dto.receiptUrl !== undefined) set.receiptUrl = dto.receiptUrl ?? null;

    const row = await this.runInTransaction(async (session) => {
      const settlement = await this.lockSettlement(event, session);
      if (settlement.status === 'SETTLED') throw eventSettled();
      const existing = await this.expenseModel
        .findOne({ _id: expenseId, eventId: event._id, deletedAt: null })
        .session(session);
      if (!existing) throw expenseNotFound();
      // The OTHER rule holds for the row as it will be, not just the patch.
      const category = (set.category as string) ?? existing.category;
      const note = 'note' in set ? set.note : existing.note;
      if (category === 'OTHER' && !note) throw otherNeedsNote();
      existing.set(set);
      await existing.save({ session });
      return existing;
    });
    return formatExpense(row.toObject());
  }

  /** Soft delete — the row stays for the audit trail. */
  async deleteExpense(eventId: string, expenseId: string, userId: string) {
    const event = await this.loadGroupEvent(eventId);
    await this.assertCashierOrOwner(event.groupId, userId);
    if (!Types.ObjectId.isValid(expenseId)) throw expenseNotFound();

    await this.runInTransaction(async (session) => {
      const settlement = await this.lockSettlement(event, session);
      if (settlement.status === 'SETTLED') throw eventSettled();
      const result = await this.expenseModel.updateOne(
        { _id: expenseId, eventId: event._id, deletedAt: null },
        {
          $set: {
            deletedAt: new Date(),
            deletedBy: new Types.ObjectId(userId),
          },
        },
        { session: session ?? undefined },
      );
      if (result.matchedCount === 0) throw expenseNotFound();
    });
  }

  // --- Fee adjustment --------------------------------------------------------

  /**
   * Replaces the price per player (`updatedPrice`), or clears it with null.
   * What members already paid is untouched; their standing is recomputed
   * against the new price on every read, so someone who paid 120 of a new
   * 150 shows as PARTIAL owing 30 and tops up with a normal submission.
   */
  async updateFee(eventId: string, userId: string, dto: UpdateFeeDto) {
    const event = await this.loadGroupEvent(eventId);
    await this.assertCashierOrOwner(event.groupId, userId);

    // `@Allow()` lets a missing key through as undefined, which parseAmount
    // rejects — going back to the original fee needs an explicit null.
    let newPriceCents: number | null = null;
    if (dto.updatedPrice !== null) {
      if (
        typeof dto.updatedPrice === 'string' &&
        dto.updatedPrice.trim().startsWith('-')
      ) {
        throw negativePrice();
      }
      newPriceCents = parseAmount(dto.updatedPrice, { allowZero: true });
    }

    const adjustment = await this.runInTransaction(async (session) => {
      const settlement = await this.lockSettlement(event, session);
      if (settlement.status === 'SETTLED') throw eventSettled();
      const previousPriceCents = pricePerPlayerCents(event);
      await this.eventModel.updateOne(
        { _id: event._id },
        {
          $set: {
            updatedPrice:
              newPriceCents === null ? null : fromCents(newPriceCents),
          },
        },
        { session: session ?? undefined },
      );
      const [row] = await this.feeAdjustmentModel.create(
        [
          {
            eventId: event._id,
            previousPrice: fromCents(previousPriceCents),
            updatedPrice:
              newPriceCents === null ? null : fromCents(newPriceCents),
            reason: dto.reason,
            createdBy: new Types.ObjectId(userId),
          },
        ],
        { session },
      );
      return row;
    });

    const updated: GroupEvent = {
      ...event,
      updatedPrice: newPriceCents === null ? null : fromCents(newPriceCents),
    };
    const income = await this.computeIncome(updated);

    // Best-effort: a failed notification must not undo a recorded change.
    const price = formatCents(income.priceCents);
    for (const member of income.members) {
      try {
        await this.notificationsService.create({
          userId: member.memberId,
          title: 'Event price updated',
          body:
            `The price for '${event.title}' is now ${price} ${CURRENCY}` +
            (member.owedCents > 0
              ? ` — you owe ${formatCents(member.owedCents)} ${CURRENCY}`
              : ''),
          type: 'event',
          refId: event._id.toString(),
        });
      } catch (err) {
        this.logger.warn(`Fee-change notification failed: ${err}`);
      }
    }

    return {
      eventId: event._id.toString(),
      feePerPlayer: formatCents(income.feeCents),
      updatedPrice: newPriceCents === null ? null : formatCents(newPriceCents),
      pricePerPlayer: price,
      players: income.players,
      expected: formatCents(income.expectedCents),
      collected: formatCents(income.collectedCents),
      outstanding: formatCents(income.outstandingCents),
      affectedMembers: income.members.length,
      adjustmentId: adjustment._id.toString(),
      updatedBy: userId,
      updatedAt: adjustment.createdAt ?? new Date(),
    };
  }

  // --- Settle / reopen -------------------------------------------------------

  /**
   * Locks the event and posts its net to the group fund, atomically.
   *
   * The posted amount is the net MINUS whatever this event already has in
   * the ledger. On a first settle that is zero, so the full net is posted.
   * After a reopen, late payments posted earlier are still in the ledger
   * (they are never reversed), and the corrected net already includes them —
   * subtracting them is what stops a resettle counting them twice.
   */
  async settle(eventId: string, userId: string, dto: SettleEventDto) {
    const event = await this.loadGroupEvent(eventId);
    await this.assertCashierOrOwner(event.groupId, userId);

    return this.runInTransaction(async (session) => {
      const settlement = await this.lockSettlement(event, session);
      if (settlement.status === 'SETTLED') throw eventSettled();
      if (!this.isEnded(event)) throw eventNotFinished();

      const income = await this.computeIncome(event, session);
      if (income.pendingReviewCount > 0) {
        throw pendingReviews(income.pendingReviewCount);
      }
      if (income.outstandingCents > 0 && dto.allowOutstanding !== true) {
        throw outstandingPayments(
          formatCents(income.outstandingCents),
          income.members
            .filter((m) => m.owedCents > 0)
            .map((m) => ({
              member: { id: m.memberId, name: m.name },
              amount: formatCents(m.owedCents),
              status: m.status,
            })),
        );
      }

      const expenses = await this.expenseBreakdown(event._id, session);
      const netCents = income.collectedCents - expenses.totalCents;
      const alreadyPostedCents = await this.eventContributionCents(
        event._id,
        session,
      );
      const amountCents = netCents - alreadyPostedCents;

      const claimed = await this.claimSettlement(
        settlement,
        'OPEN',
        'SETTLED',
        session,
      );
      if (!claimed) throw eventSettled();

      const { tx, balanceAfterCents } = await this.postFundTransaction(
        session,
        {
          groupId: event.groupId,
          eventId: event._id,
          type: 'EVENT_SETTLEMENT',
          amountCents,
          incomeDeltaCents: amountCents + expenses.totalCents,
          expenseDeltaCents: expenses.totalCents,
          note: dto.note ?? null,
          createdBy: userId,
        },
      );

      const settledAt = new Date();
      claimed.set({
        collected: fromCents(income.collectedCents),
        expenses: fromCents(expenses.totalCents),
        net: fromCents(netCents),
        outstanding: fromCents(income.outstandingCents),
        note: dto.note ?? null,
        fundTransactionId: tx._id,
        settledBy: new Types.ObjectId(userId),
        settledAt,
      });
      await claimed.save({ session });

      return {
        eventId: event._id.toString(),
        status: 'SETTLED',
        collected: formatCents(income.collectedCents),
        expenses: formatCents(expenses.totalCents),
        net: formatCents(netCents),
        outstanding: formatCents(income.outstandingCents),
        fundTransactionId: tx._id.toString(),
        groupFundBalance: formatCents(balanceAfterCents),
        settledAt,
      };
    });
  }

  /**
   * Undoes a settlement so expenses can be fixed. The original ledger row
   * stays; a SETTLEMENT_REVERSAL of the opposite amount is added. Late
   * payments posted while settled are NOT reversed.
   */
  async reopen(eventId: string, userId: string, dto: ReopenEventDto) {
    const event = await this.loadGroupEvent(eventId);
    await this.assertOwner(event.groupId, userId);

    await this.runInTransaction(async (session) => {
      const settlement = await this.lockSettlement(event, session);
      if (settlement.status !== 'SETTLED') throw eventNotSettled();
      const claimed = await this.claimSettlement(
        settlement,
        'SETTLED',
        'OPEN',
        session,
      );
      if (!claimed) throw eventNotSettled();

      const original = settlement.fundTransactionId
        ? await this.fundTxModel
            .findById(settlement.fundTransactionId)
            .session(session)
            .lean()
        : null;
      const postedCents = toCents(original?.amount ?? 0);
      const expensesCents = toCents(settlement.expenses);

      await this.postFundTransaction(session, {
        groupId: event.groupId,
        eventId: event._id,
        type: 'SETTLEMENT_REVERSAL',
        amountCents: -postedCents,
        incomeDeltaCents: -(postedCents + expensesCents),
        expenseDeltaCents: -expensesCents,
        note: dto.reason,
        createdBy: userId,
      });

      claimed.set({
        fundTransactionId: null,
        settledBy: null,
        settledAt: null,
        reopenedBy: new Types.ObjectId(userId),
        reopenedAt: new Date(),
        reopenReason: dto.reason,
      });
      await claimed.save({ session });
    });

    return this.buildEventFinance(event);
  }

  // --- Review side effect ----------------------------------------------------

  /**
   * Called by `EventsService.reviewPayment` inside its transaction, after the
   * payment row's `paidAmount` moved from `paidBefore` to `paidAfter` cents.
   *
   * On a SETTLED event the change reaches the fund immediately: money in is
   * a LATE_PAYMENT, money taken back (approved -> rejected) a
   * PAYMENT_REVERSAL. The event stays settled; its snapshot figures move.
   * On an OPEN event nothing is posted — settle will count it.
   */
  async onPaymentReviewed(
    session: ClientSession | null,
    input: {
      eventId: string;
      memberId: string;
      memberName?: string | null;
      paidBeforeCents: number;
      paidAfterCents: number;
      reviewerId: string;
    },
  ) {
    const deltaCents = input.paidAfterCents - input.paidBeforeCents;
    if (deltaCents === 0) return;

    const event = await this.loadGroupEvent(input.eventId, session);
    const settlement = await this.lockSettlement(event, session);
    if (settlement.status !== 'SETTLED') return;

    await this.postFundTransaction(session, {
      groupId: event.groupId,
      eventId: event._id,
      type: deltaCents > 0 ? 'LATE_PAYMENT' : 'PAYMENT_REVERSAL',
      amountCents: deltaCents,
      incomeDeltaCents: deltaCents,
      expenseDeltaCents: 0,
      note: input.memberName ?? null,
      memberId: input.memberId,
      createdBy: input.reviewerId,
    });

    // Refresh the snapshot so the group summary shows the event's real total.
    const income = await this.computeIncome(event, session);
    settlement.set({
      collected: fromCents(income.collectedCents),
      net: fromCents(income.collectedCents - toCents(settlement.expenses)),
      outstanding: fromCents(income.outstandingCents),
    });
    await settlement.save({ session });
  }

  // --- Group fund --------------------------------------------------------------

  async getGroupFund(groupId: string, userId: string) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new NotFoundException('Group not found');
    }
    await this.assertCanRead(groupId, userId);
    return this.buildGroupFund(groupId);
  }

  /**
   * The group-detail fund block. No access check — callers decide (the
   * group detail embeds it for members only).
   */
  async buildGroupFund(groupId: string) {
    const gid = new Types.ObjectId(groupId);
    const [fund, settledEvents, recent, outstanding] = await Promise.all([
      this.fundModel.findOne({ groupId: gid }).lean(),
      this.settlementModel.countDocuments({ groupId: gid, status: 'SETTLED' }),
      this.settlementModel
        .find({ groupId: gid, status: 'SETTLED' })
        .sort({ settledAt: -1 })
        .limit(RECENT_EVENTS)
        .populate('eventId', 'title date')
        .lean(),
      this.outstandingLines(
        await this.eventsForOutstanding({
          groupId: gid,
          eventStatus: 'settled',
        }),
        { includePending: true },
      ),
    ]);

    return {
      groupId,
      currency: CURRENCY,
      balance: formatBaht(fund?.balance ?? 0),
      totals: {
        income: formatBaht(fund?.totalIncome ?? 0),
        expenses: formatBaht(fund?.totalExpenses ?? 0),
      },
      outstanding: formatCents(
        outstanding.reduce((sum, line) => sum + line.owedCents, 0),
      ),
      settledEvents,
      recentEvents: recent.map((row) => {
        const ev = row.eventId as unknown as {
          _id: Types.ObjectId;
          title?: string;
          date?: Date;
        } | null;
        return {
          eventId: (ev?._id ?? row.eventId)?.toString(),
          title: ev?.title ?? null,
          date: ev?.date ? isoDate(ev.date) : null,
          collected: formatBaht(row.collected),
          expenses: formatBaht(row.expenses),
          net: formatBaht(row.net),
          outstanding: formatBaht(row.outstanding),
        };
      }),
      updatedAt: fund?.updatedAt ?? null,
    };
  }

  async listFundTransactions(
    groupId: string,
    userId: string,
    query: ListFundTransactionsQuery,
  ) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new NotFoundException('Group not found');
    }
    await this.assertCanRead(groupId, userId);

    const limit = clampLimit(query.limit ?? NaN);
    const filter: Record<string, unknown> = {
      groupId: new Types.ObjectId(groupId),
    };
    if (query.type) filter.type = query.type;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    const and: Record<string, unknown>[] = [filter];
    if (query.cursor) {
      and.push(keysetFilter(decodeCursor(query.cursor), 'createdAt', -1));
    }

    const rows = await this.fundTxModel
      .find({ $and: and })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items: items.map((row) => ({
        id: row._id.toString(),
        type: row.type,
        amount: formatBaht(row.amount),
        balanceAfter: formatBaht(row.balanceAfter),
        eventId: row.eventId?.toString() ?? null,
        memberId: row.memberId?.toString() ?? null,
        note: row.note ?? null,
        createdBy: row.createdBy?.toString() ?? null,
        createdAt: row.createdAt ?? null,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              d: new Date(last.createdAt!).toISOString(),
              i: last._id.toString(),
            })
          : null,
    };
  }

  /**
   * Expense line items across the group's events, newest first — the
   * itemized side of `totals.expenses` in the fund summary, though this
   * also lists expenses on events not settled yet. Same audience as the
   * per-event list: the cashier and owner, or every approved member when
   * the group turned on `showExpenseDetailsToMembers`.
   *
   * `total` sums every match of the filters, not just this page.
   */
  async listGroupExpenses(
    groupId: string,
    userId: string,
    query: ListGroupExpensesQuery,
  ) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new NotFoundException('Group not found');
    }
    const group = await this.loadGroup(groupId);
    if (group.showExpenseDetailsToMembers) {
      await this.assertCanRead(groupId, userId);
    } else {
      await this.assertCashierOrOwner(groupId, userId);
    }

    const events = await this.eventModel
      .find({
        groupId: new Types.ObjectId(groupId),
        ...(query.eventId ? { _id: new Types.ObjectId(query.eventId) } : {}),
      })
      .select('_id title date')
      .lean();
    const eventById = new Map(events.map((ev) => [ev._id.toString(), ev]));

    const limit = clampLimit(query.limit ?? NaN);
    const filter: Record<string, unknown> = {
      eventId: { $in: events.map((ev) => ev._id) },
      deletedAt: null,
    };
    if (query.category) filter.category = query.category;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    const and: Record<string, unknown>[] = [filter];
    if (query.cursor) {
      and.push(keysetFilter(decodeCursor(query.cursor), 'createdAt', -1));
    }

    const [rows, totals] = await Promise.all([
      this.expenseModel
        .find({ $and: and })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean(),
      this.expenseModel.aggregate<{ amount: number }>([
        { $match: filter },
        { $group: { _id: null, amount: { $sum: '$amount' } } },
      ]),
    ]);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1] as
      | ((typeof items)[number] & { createdAt?: Date })
      | undefined;

    const settled = await this.settlementModel
      .find({
        eventId: { $in: [...new Set(items.map((row) => row.eventId))] },
        status: 'SETTLED',
      })
      .select('eventId')
      .lean();
    const settledIds = new Set(settled.map((s) => s.eventId.toString()));

    return {
      groupId,
      currency: CURRENCY,
      total: formatBaht(totals[0]?.amount ?? 0),
      items: items.map((row) => {
        const event = eventById.get(row.eventId.toString())!;
        return {
          ...formatExpense(row),
          event: {
            id: event._id.toString(),
            title: event.title,
            date: isoDate(event.date),
          },
          eventSettled: settledIds.has(row.eventId.toString()),
        };
      }),
      nextCursor:
        hasMore && last?.createdAt
          ? encodeCursor({
              d: new Date(last.createdAt).toISOString(),
              i: last._id.toString(),
            })
          : null,
    };
  }

  /**
   * Events whose fees can be owed: settled ones, plus (for `all`) every
   * event that has ended but is not settled yet. Upcoming and cancelled
   * events owe nothing.
   */
  private async eventsForOutstanding(opts: {
    groupId?: Types.ObjectId;
    eventIds?: Types.ObjectId[];
    eventStatus: 'all' | 'settled';
  }): Promise<Array<GroupEvent & { settled: boolean }>> {
    const scope: Record<string, unknown> = {};
    if (opts.groupId) scope.groupId = opts.groupId;
    if (opts.eventIds) scope.eventId = { $in: opts.eventIds };

    const settledRows = await this.settlementModel
      .find({ ...scope, status: 'SETTLED' })
      .select('eventId')
      .lean();
    const settledIds = new Set(settledRows.map((r) => r.eventId.toString()));

    const settledEventIds = settledRows.map((r) => r.eventId);
    const eventFilter: Record<string, unknown> =
      opts.eventStatus === 'settled'
        ? { _id: { $in: settledEventIds } }
        : {
            groupId: opts.groupId ?? { $ne: null },
            status: { $ne: 'cancelled' },
            $or: [
              { status: { $in: ENDED_STATUSES } },
              { endTime: { $lte: new Date() } },
              { _id: { $in: settledEventIds } },
            ],
            ...(opts.eventIds ? { _id: { $in: opts.eventIds } } : {}),
          };

    const events = await this.eventModel
      .find(eventFilter)
      .select(EVENT_FIELDS)
      .lean();
    return (events as unknown as GroupEvent[]).map((ev) => ({
      ...ev,
      settled: settledIds.has(ev._id.toString()),
    }));
  }

  /** Every (event, member) pair still owing on the given events. */
  private async outstandingLines(
    events: Array<GroupEvent & { settled: boolean }>,
    opts: { includePending: boolean; memberId?: string },
  ) {
    const lines: Array<{
      event: GroupEvent & { settled: boolean };
      memberId: string;
      name: string | null;
      status: MemberBalanceStatus;
      owedCents: number;
    }> = [];
    for (const event of events) {
      const income = await this.computeIncome(event);
      for (const m of income.members) {
        if (m.owedCents === 0) continue;
        if (m.status === 'PENDING' && !opts.includePending) continue;
        if (opts.memberId && m.memberId !== opts.memberId) continue;
        lines.push({
          event,
          memberId: m.memberId,
          name: m.name,
          status: m.status,
          owedCents: m.owedCents,
        });
      }
    }
    return lines;
  }

  private groupOutstanding(
    lines: Awaited<ReturnType<FinanceService['outstandingLines']>>,
  ) {
    const byMember = new Map<
      string,
      { name: string | null; totalCents: number; events: typeof lines }
    >();
    for (const line of lines) {
      const entry = byMember.get(line.memberId) ?? {
        name: line.name,
        totalCents: 0,
        events: [],
      };
      entry.totalCents += line.owedCents;
      entry.events.push(line);
      byMember.set(line.memberId, entry);
    }
    // Highest debt first; member id breaks ties so paging is stable.
    return [...byMember.entries()]
      .sort(
        ([idA, a], [idB, b]) =>
          b.totalCents - a.totalCents || idA.localeCompare(idB),
      )
      .map(([memberId, entry]) => ({
        member: { id: memberId, name: entry.name },
        totalCents: entry.totalCents,
        totalOwed: formatCents(entry.totalCents),
        events: entry.events
          .sort(
            (a, b) =>
              new Date(a.event.date).getTime() -
              new Date(b.event.date).getTime(),
          )
          .map((line) => ({
            eventId: line.event._id.toString(),
            title: line.event.title,
            date: isoDate(line.event.date),
            amount: formatCents(line.owedCents),
            status: line.status,
            eventSettled: line.event.settled,
          })),
      }));
  }

  private pageOutstanding(
    rows: ReturnType<FinanceService['groupOutstanding']>,
    limitIn: number | undefined,
    cursor: string | undefined,
  ) {
    const limit = clampLimit(limitIn ?? NaN);
    let start = 0;
    if (cursor) {
      // Keyset on the sort key (totalCents desc, member id asc), not a lookup
      // of the last member: totals move between requests, and a member who
      // paid off drops out of the list — finding them would fail and restart
      // at page 1.
      const { t, i } = decodeOutstandingCursor(cursor);
      start = rows.findIndex(
        (row) =>
          row.totalCents < t ||
          (row.totalCents === t && row.member.id.localeCompare(i) > 0),
      );
      if (start === -1) start = rows.length;
    }
    const page = rows.slice(start, start + limit);
    const hasMore = start + limit < rows.length;
    const last = page[page.length - 1];
    return {
      items: page.map(({ totalCents: _omit, ...row }) => row),
      nextCursor:
        hasMore && last
          ? encodeOutstandingCursor(last.totalCents, last.member.id)
          : null,
    };
  }

  async listGroupOutstanding(
    groupId: string,
    userId: string,
    query: ListOutstandingQuery,
  ) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new NotFoundException('Group not found');
    }
    await this.assertCashierOrOwner(groupId, userId);

    const events = await this.eventsForOutstanding({
      groupId: new Types.ObjectId(groupId),
      eventStatus: query.eventStatus ?? 'all',
    });
    const rows = this.groupOutstanding(
      await this.outstandingLines(events, {
        includePending: query.includePending ?? true,
        memberId: query.memberId,
      }),
    );
    return {
      groupId,
      currency: CURRENCY,
      totalOutstanding: formatCents(
        rows.reduce((sum, row) => sum + row.totalCents, 0),
      ),
      playerCount: rows.length,
      ...this.pageOutstanding(rows, query.limit, query.cursor),
    };
  }

  /**
   * The caller's own debts — across every group event they joined, or one
   * group's with `?groupId=`.
   */
  async listMyOutstanding(userId: string, query: MyOutstandingQuery) {
    const joined = await this.playerModel
      .find({ userId: new Types.ObjectId(userId), status: 'joined' })
      .select('eventId')
      .lean();
    const events = await this.eventsForOutstanding({
      groupId: query.groupId ? new Types.ObjectId(query.groupId) : undefined,
      eventIds: joined.map((row) => row.eventId),
      eventStatus: query.eventStatus ?? 'all',
    });
    const rows = this.groupOutstanding(
      await this.outstandingLines(events, {
        includePending: query.includePending ?? true,
        memberId: userId,
      }),
    );
    return {
      groupId: query.groupId ?? null,
      currency: CURRENCY,
      totalOutstanding: formatCents(
        rows.reduce((sum, row) => sum + row.totalCents, 0),
      ),
      playerCount: rows.length,
      items: rows.map(({ totalCents: _omit, ...row }) => row),
      nextCursor: null,
    };
  }
}

// --- helpers -----------------------------------------------------------------

/**
 * The two ways a standalone mongod refuses a transaction: code 20 when the
 * URI has retryWrites=false, and — with the default retryWrites=true — a
 * driver-rewritten message carrying no code at all.
 */
function isTransactionUnsupported(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null;
  return (
    e?.code === 20 ||
    /Transaction numbers are only allowed on a replica set|does not support retryable writes/i.test(
      e?.message ?? '',
    )
  );
}

/**
 * Cursor for the in-memory outstanding list: the last row's sort key
 * (totalCents, member id). Same opaque base64url JSON as the shared cursor,
 * which only carries a date, not a number.
 */
function encodeOutstandingCursor(totalCents: number, memberId: string) {
  return Buffer.from(JSON.stringify({ t: totalCents, i: memberId })).toString(
    'base64url',
  );
}

function decodeOutstandingCursor(cursor: string): { t: number; i: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  const { t, i } = (parsed ?? {}) as Record<string, unknown>;
  if (
    typeof t !== 'number' ||
    !Number.isFinite(t) ||
    typeof i !== 'string' ||
    !Types.ObjectId.isValid(i)
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  return { t, i };
}

function displayName(
  user: { name?: string; displayName?: string; username?: string } | null,
): string | null {
  return user?.displayName || user?.name || user?.username || null;
}

function isoDate(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

function formatExpense(row: {
  _id: Types.ObjectId;
  category: string;
  amount: number;
  note?: string | null;
  paidMethod?: string | null;
  receiptUrl?: string | null;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: row._id.toString(),
    category: row.category,
    amount: formatBaht(row.amount),
    note: row.note ?? null,
    paidMethod: row.paidMethod ?? null,
    receiptUrl: row.receiptUrl ?? null,
    createdBy: row.createdBy?.toString() ?? null,
    updatedBy: row.updatedBy?.toString() ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}
