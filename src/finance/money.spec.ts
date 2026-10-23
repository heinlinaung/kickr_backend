// src/finance/money.spec.ts
import { BadRequestException } from '@nestjs/common';
import {
  feePerPlayerCents,
  formatCents,
  memberBalance,
  paidCents,
  parseAmount,
  pricePerPlayerCents,
  submissionCents,
  toCents,
} from './money';

describe('money', () => {
  describe('parseAmount', () => {
    it('reads 2-place strings as satang', () => {
      expect(parseAmount('1800.00')).toBe(180000);
      expect(parseAmount('0.10')).toBe(10);
    });

    it.each([
      ['a number', 1800],
      ['one decimal place', '1800.0'],
      ['no decimals', '1800'],
      ['a negative', '-5.00'],
      ['missing', undefined],
    ])('rejects %s with INVALID_AMOUNT', (_label, value) => {
      try {
        parseAmount(value);
        fail('expected a throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          code: 'INVALID_AMOUNT',
        });
      }
    });

    it('rejects zero unless allowed (a free price is legal)', () => {
      expect(() => parseAmount('0.00')).toThrow(BadRequestException);
      expect(parseAmount('0.00', { allowZero: true })).toBe(0);
    });
  });

  it('formats signed satang without float dust', () => {
    expect(formatCents(28000)).toBe('280.00');
    expect(formatCents(-20005)).toBe('-200.05');
    expect(formatCents(toCents(0.1 + 0.2))).toBe('0.30');
  });

  describe('prices', () => {
    it('the fee is price, plus the surcharge only when taken', () => {
      expect(feePerPlayerCents({ price: 100, additionalPrice: 20 })).toBe(
        10000,
      );
      expect(
        feePerPlayerCents({
          price: 100,
          additionalPrice: 20,
          takeAdditionalPrice: true,
        }),
      ).toBe(12000);
    });

    it('updatedPrice replaces the fee — including a 0 price', () => {
      expect(pricePerPlayerCents({ price: 120, updatedPrice: 150 })).toBe(
        15000,
      );
      expect(pricePerPlayerCents({ price: 120, updatedPrice: 0 })).toBe(0);
      expect(pricePerPlayerCents({ price: 120, updatedPrice: null })).toBe(
        12000,
      );
    });
  });

  describe('memberBalance (price 150, fee 120)', () => {
    const balance = (row: any) => memberBalance(row, 15000, 12000);

    it('no row: UNPAID for the full price', () => {
      expect(balance(null)).toMatchObject({
        status: 'UNPAID',
        owedCents: 15000,
      });
    });

    it('rejected with nothing approved: UNPAID', () => {
      expect(balance({ status: 'rejected', paidAmount: 0 }).status).toBe(
        'UNPAID',
      );
    });

    it('paid 120 of 150: PARTIAL owing 30', () => {
      expect(balance({ status: 'approved', paidAmount: 120 })).toMatchObject({
        status: 'PARTIAL',
        owedCents: 3000,
      });
    });

    it('a top-up waiting for review: PENDING for the difference', () => {
      expect(
        balance({ status: 'submitted', amount: 30, paidAmount: 120 }),
      ).toMatchObject({ status: 'PENDING', owedCents: 3000 });
    });

    it('paid exactly: APPROVED; paid more: OVERPAID with credit', () => {
      expect(balance({ status: 'approved', paidAmount: 150 }).status).toBe(
        'APPROVED',
      );
      expect(
        memberBalance({ status: 'approved', paidAmount: 120 }, 10000, 12000),
      ).toMatchObject({ status: 'OVERPAID', owedCents: 0, creditCents: 2000 });
    });

    it('a legacy approved row (no paidAmount) paid the fee', () => {
      expect(paidCents({ status: 'approved' }, 12000)).toBe(12000);
      expect(balance({ status: 'approved' })).toMatchObject({
        status: 'PARTIAL',
        owedCents: 3000,
      });
    });
  });

  describe('submissionCents', () => {
    it('uses the recorded amount when there is one', () => {
      expect(
        submissionCents({ status: 'submitted', amount: 30 }, 15000, 12000),
      ).toBe(3000);
    });

    it('legacy rows: approved = the fee; pending = what is owed now', () => {
      expect(submissionCents({ status: 'approved' }, 15000, 12000)).toBe(12000);
      expect(submissionCents({ status: 'submitted' }, 15000, 12000)).toBe(
        15000,
      );
    });
  });
});
