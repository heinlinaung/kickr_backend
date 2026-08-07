import {
  EVENT_STATUSES,
  EventStatus,
  allowedTransitions,
  canEnterScore,
  canJoin,
  canLeave,
  canModify,
  canShuffle,
  canSubmitResult,
  canTransition,
  isEventStatus,
} from './events.lifecycle';

/**
 * The spec's §4.1 table, transcribed independently of the implementation.
 * Written as data so the exhaustive test below can assert on EVERY ordered
 * pair — including the 30 that must be rejected — rather than spot-checking.
 */
const LEGAL: ReadonlyArray<[EventStatus, EventStatus]> = [
  ['join', 'before_match'],
  ['before_match', 'preparation'],
  ['before_match', 'join'],
  ['preparation', 'playing'],
  ['preparation', 'before_match'],
  ['playing', 'after_match'],
  ['after_match', 'done'],
];

const isLegal = (from: EventStatus, to: EventStatus) =>
  LEGAL.some(([f, t]) => f === from && t === to);

describe('event lifecycle — transition table', () => {
  it('declares exactly the six spec states, in lifecycle order', () => {
    expect([...EVENT_STATUSES]).toEqual([
      'join',
      'before_match',
      'preparation',
      'playing',
      'after_match',
      'done',
    ]);
  });

  // 6 x 6 = 36 ordered pairs. Every one is asserted, so adding an edge to the
  // implementation without updating the spec transcription above fails here.
  describe.each(EVENT_STATUSES)('from %s', (from) => {
    it.each(EVENT_STATUSES)(`-> %s`, (to) => {
      expect(canTransition(from, to)).toBe(isLegal(from, to));
    });
  });

  it('allows exactly seven transitions in total', () => {
    const count = EVENT_STATUSES.flatMap((from) =>
      EVENT_STATUSES.filter((to) => canTransition(from, to)),
    ).length;
    expect(count).toBe(LEGAL.length);
  });

  it('treats done as terminal', () => {
    expect(allowedTransitions('done')).toEqual([]);
    for (const to of EVENT_STATUSES) {
      expect(canTransition('done', to)).toBe(false);
    }
  });

  it('rejects self-transitions', () => {
    for (const s of EVENT_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it('rejects the legacy open/full/done values and other junk', () => {
    const junk = ['open', 'full', 'JOIN', '', null, undefined, 7, {}];
    for (const bad of junk) {
      expect(canTransition(bad, 'join')).toBe(false);
      expect(canTransition('join', bad)).toBe(false);
      expect(isEventStatus(bad)).toBe(false);
    }
    // 'done' is the one legacy value that survives the migration unchanged
    expect(isEventStatus('done')).toBe(true);
  });

  it('never allows skipping a state forward', () => {
    // e.g. join -> playing, join -> done, before_match -> after_match
    expect(canTransition('join', 'preparation')).toBe(false);
    expect(canTransition('join', 'playing')).toBe(false);
    expect(canTransition('join', 'done')).toBe(false);
    expect(canTransition('before_match', 'playing')).toBe(false);
    expect(canTransition('preparation', 'after_match')).toBe(false);
    expect(canTransition('playing', 'done')).toBe(false);
  });

  it('allows reopening registration but not un-playing a match', () => {
    expect(canTransition('before_match', 'join')).toBe(true);
    expect(canTransition('preparation', 'before_match')).toBe(true);
    // no way back out of playing / after_match
    expect(canTransition('playing', 'preparation')).toBe(false);
    expect(canTransition('after_match', 'playing')).toBe(false);
  });

  it('allowedTransitions agrees with canTransition and is safe on junk', () => {
    for (const from of EVENT_STATUSES) {
      for (const to of EVENT_STATUSES) {
        expect(allowedTransitions(from).includes(to)).toBe(
          canTransition(from, to),
        );
      }
    }
    expect(allowedTransitions('open')).toEqual([]);
    expect(allowedTransitions(undefined)).toEqual([]);
  });
});

describe('event lifecycle — action gates', () => {
  const gates = {
    canJoin: { fn: canJoin, allowed: ['join'] },
    canLeave: { fn: canLeave, allowed: ['join'] },
    canShuffle: { fn: canShuffle, allowed: ['preparation'] },
    canEnterScore: { fn: canEnterScore, allowed: ['playing', 'after_match'] },
    canSubmitResult: { fn: canSubmitResult, allowed: ['after_match'] },
    canModify: {
      fn: canModify,
      allowed: ['join', 'before_match', 'preparation', 'playing', 'after_match'],
    },
  };

  describe.each(Object.entries(gates))('%s', (_name, { fn, allowed }) => {
    it.each(EVENT_STATUSES)('%s', (status) => {
      expect(fn(status)).toBe(allowed.includes(status));
    });

    it('rejects junk', () => {
      for (const bad of ['open', 'full', '', null, undefined, 0]) {
        expect(fn(bad)).toBe(false);
      }
    });
  });

  it('scoring is impossible before kick-off', () => {
    expect(canEnterScore('join')).toBe(false);
    expect(canEnterScore('before_match')).toBe(false);
    expect(canEnterScore('preparation')).toBe(false);
  });

  // Guards the §4.3 claim that re-shuffling cannot discard entered scores:
  // the two gates share no state.
  it('shuffle and score entry never overlap', () => {
    for (const s of EVENT_STATUSES) {
      expect(canShuffle(s) && canEnterScore(s)).toBe(false);
    }
  });

  it('a done event is frozen to every action', () => {
    for (const { fn } of Object.values(gates)) {
      expect(fn('done')).toBe(false);
    }
  });
});
