// src/events/events.formation.spec.ts
import {
  parseFormation,
  placedIds,
  validateFormationLayout,
} from './events.formation';

/** Build groups by sizes, with unique ids: gk, d1.., m1.., f1.. */
const groups = (d: number, m: number, f: number) => ({
  goalkeeper: 'gk',
  defenders: Array.from({ length: d }, (_, i) => `d${i + 1}`),
  midfielders: Array.from({ length: m }, (_, i) => `m${i + 1}`),
  forwards: Array.from({ length: f }, (_, i) => `f${i + 1}`),
});

describe('parseFormation', () => {
  it.each([
    ['4-4-2', [4, 4, 2]],
    ['2-2', [2, 2]],
    ['4', [4]],
    ['1-1-1-1', [1, 1, 1, 1]],
  ])('parses %s', (text, expected) => {
    expect(parseFormation(text)).toEqual(expected);
  });

  it.each([
    ['a zero line', '4-0-2'],
    ['letters', '4-x-2'],
    ['a trailing dash', '4-4-'],
    ['a leading dash', '-4-4'],
    ['spaces', '4 - 4 - 2'],
    ['empty', ''],
  ])('rejects %s', (_label, text) => {
    expect(parseFormation(text)).toBeNull();
  });
});

describe('validateFormationLayout', () => {
  it('accepts the canonical 4-4-2 with 11 players', () => {
    expect(validateFormationLayout('4-4-2', groups(4, 4, 2), 11)).toBeNull();
  });

  describe("the line-to-group mapping is the client's call", () => {
    // "2-2" fits ANY two non-empty groups whose sizes are 2 and 2, in
    // defenders -> midfielders -> forwards order.
    it.each([
      ['defenders + forwards', groups(2, 0, 2)],
      ['defenders + midfielders', groups(2, 2, 0)],
      ['midfielders + forwards', groups(0, 2, 2)],
    ])('2-2 as %s', (_label, g) => {
      expect(validateFormationLayout('2-2', g, 5)).toBeNull();
    });

    it('rejects 2-2 spread across three groups', () => {
      expect(validateFormationLayout('2-2', groups(2, 1, 1), 5)).toMatch(
        /do not match formation '2-2'/,
      );
    });

    it('order within the non-empty groups still matters', () => {
      // 3-1: three in the EARLIER group. 1 defender + 3 forwards is 1-3.
      expect(validateFormationLayout('3-1', groups(1, 0, 3), 5)).toMatch(
        /do not match/,
      );
      expect(validateFormationLayout('3-1', groups(3, 0, 1), 5)).toBeNull();
    });
  });

  it('rejects a malformed formation string with guidance', () => {
    expect(validateFormationLayout('4-0-2', groups(4, 0, 2), 7)).toMatch(
      /positive numbers joined by dashes/,
    );
  });

  it('rejects when segments + goalkeeper disagree with playerCount', () => {
    expect(validateFormationLayout('4-4-2', groups(4, 4, 2), 10)).toMatch(
      /10 outfield players \+ 1 goalkeeper = 11, but playerCount is 10/,
    );
  });

  it('rejects an all-empty outfield', () => {
    expect(
      validateFormationLayout('4-4-2', groups(0, 0, 0), 11),
    ).toMatch(/no outfield players/);
  });

  it('rejects the same player in two positions', () => {
    const g = groups(2, 0, 2);
    g.forwards[1] = g.defenders[0]; // d1 placed twice
    expect(validateFormationLayout('2-2', g, 5)).toMatch(
      /more than one position/,
    );
  });

  it('rejects the goalkeeper doubling as an outfielder', () => {
    const g = groups(2, 0, 2);
    g.defenders[0] = g.goalkeeper;
    expect(validateFormationLayout('2-2', g, 5)).toMatch(
      /more than one position/,
    );
  });
});

describe('placedIds', () => {
  it('lists goalkeeper first, then groups in order, preserving slot order', () => {
    expect(placedIds(groups(2, 1, 1))).toEqual([
      'gk',
      'd1',
      'd2',
      'm1',
      'f1',
    ]);
  });
});
