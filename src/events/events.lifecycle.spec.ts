import {
  EVENT_STATUSES,
  NON_FOOTBALL_EVENT_STATUSES,
  EventStatus,
  allowedTransitions,
  buildStageFor,
  canEnterScore,
  canJoin,
  canLeave,
  canModify,
  canShuffle,
  canSubmitResult,
  canTransition,
  isEventStatus,
  isFootball,
  statusesFor,
} from './events.lifecycle';

/**
 * The spec's §4.1 table, transcribed independently of the implementation.
 * Written as data so the exhaustive test below can assert on EVERY ordered
 * pair — including the 30 that must be rejected — rather than spot-checking.
 */
const LEGAL: ReadonlyArray<[EventStatus, EventStatus]> = [
  ['join', 'preparation'],
  ['preparation', 'ready_to_play'],
  // Reverse edge: reopens registration after backing out of team assignment.
  // Absorbs what preparation -> before_match -> join used to do.
  ['preparation', 'join'],
  ['ready_to_play', 'playing'],
  // Reverse edge: the teams were reviewed and are wrong, so go back and
  // re-shuffle. Safe because scoring cannot have started yet.
  ['ready_to_play', 'preparation'],
  ['playing', 'after_match'],
  ['after_match', 'done'],
];

const isLegal = (from: EventStatus, to: EventStatus) =>
  LEGAL.some(([f, t]) => f === from && t === to);

describe('event lifecycle — transition table', () => {
  it('declares exactly the six spec states, in lifecycle order', () => {
    // `ready_to_play` sits between team assignment and kick-off: teams are
    // final and reviewable, but the match has not started. Unlike the removed
    // `before_match`, it gates something real — canShuffle is false here, so
    // the roster is frozen.
    expect([...EVENT_STATUSES]).toEqual([
      'join',
      'preparation',
      'ready_to_play',
      'playing',
      'after_match',
      'done',
    ]);
  });

  it('no longer recognises before_match', () => {
    expect(isEventStatus('before_match')).toBe(false);
    // And it cannot be reached or left, so an event cannot get stranded there.
    expect(canTransition('join', 'before_match' as EventStatus)).toBe(false);
    expect(canTransition('before_match' as EventStatus, 'preparation')).toBe(
      false,
    );
  });

  // 6 x 6 = 36 ordered pairs. Every one is asserted, so adding an edge to the
  // implementation without updating the spec transcription above fails here.
  describe.each(EVENT_STATUSES)('from %s', (from) => {
    it.each(EVENT_STATUSES)(`-> %s`, (to) => {
      expect(canTransition(from, to)).toBe(isLegal(from, to));
    });
  });

  it('allows exactly the transitions transcribed above, and no others', () => {
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
    // join -> preparation IS legal (before_match is gone), so the skips start
    // one step further along.
    expect(canTransition('join', 'ready_to_play')).toBe(false);
    expect(canTransition('join', 'playing')).toBe(false);
    expect(canTransition('join', 'after_match')).toBe(false);
    expect(canTransition('join', 'done')).toBe(false);
    expect(canTransition('preparation', 'after_match')).toBe(false);
    expect(canTransition('preparation', 'done')).toBe(false);
    expect(canTransition('ready_to_play', 'after_match')).toBe(false);
    expect(canTransition('ready_to_play', 'done')).toBe(false);
    expect(canTransition('playing', 'done')).toBe(false);
  });

  // BREAKING: this edge used to be legal. Kick-off now goes through
  // ready_to_play, so a client doing preparation -> playing gets a 409.
  it('no longer allows preparation straight to playing', () => {
    expect(canTransition('preparation', 'playing')).toBe(false);
    expect(allowedTransitions('preparation')).toEqual(
      expect.arrayContaining(['ready_to_play', 'join']),
    );
    expect(allowedTransitions('preparation')).not.toContain('playing');
  });

  it('routes kick-off through ready_to_play', () => {
    // The full forward path, one step at a time.
    expect(canTransition('join', 'preparation')).toBe(true);
    expect(canTransition('preparation', 'ready_to_play')).toBe(true);
    expect(canTransition('ready_to_play', 'playing')).toBe(true);
    expect(canTransition('playing', 'after_match')).toBe(true);
    expect(canTransition('after_match', 'done')).toBe(true);
  });

  it('lets a reviewed-but-wrong team set go back to preparation', () => {
    expect(canTransition('ready_to_play', 'preparation')).toBe(true);
    // But not all the way back to registration in one move.
    expect(canTransition('ready_to_play', 'join')).toBe(false);
  });

  it('allows reopening registration but not un-playing a match', () => {
    expect(canTransition('preparation', 'join')).toBe(true);
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
    // NOT ready_to_play: that state exists to freeze the roster.
    canShuffle: { fn: canShuffle, allowed: ['preparation'] },
    canEnterScore: { fn: canEnterScore, allowed: ['playing', 'after_match'] },
    canSubmitResult: { fn: canSubmitResult, allowed: ['after_match'] },
    canModify: {
      fn: canModify,
      allowed: [
        'join',
        'preparation',
        'ready_to_play',
        'playing',
        'after_match',
      ],
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
    expect(canEnterScore('preparation')).toBe(false);
    // ready_to_play is still before the whistle: teams are set, no score yet.
    expect(canEnterScore('ready_to_play')).toBe(false);
  });

  // This is what makes ready_to_play a real state rather than a label: the
  // roster is frozen. Teams are built in preparation and only viewed here.
  it('freezes the roster in ready_to_play', () => {
    expect(canShuffle('preparation')).toBe(true);
    expect(canShuffle('ready_to_play')).toBe(false);
    // Joining and leaving closed even earlier, so the roster cannot change
    // underneath a team set that has already been reviewed.
    expect(canJoin('ready_to_play')).toBe(false);
    expect(canLeave('ready_to_play')).toBe(false);
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

describe('event lifecycle — sport-aware (non-football skips preparation)', () => {
  const SPORT = 'badminton';

  /**
   * The non-football table, transcribed independently of the implementation —
   * football's edges with `preparation` cut out and its edges rewired.
   */
  const NON_FOOTBALL_LEGAL: ReadonlyArray<[EventStatus, EventStatus]> = [
    ['join', 'ready_to_play'],
    ['ready_to_play', 'playing'],
    // Reverse edge lands back in registration — there is no build stage.
    ['ready_to_play', 'join'],
    ['playing', 'after_match'],
    ['after_match', 'done'],
    // Escape edges only: nothing can ENTER preparation for these sports, but
    // a group switching sport away from football can leave an event stranded
    // there, and it must be able to get out.
    ['preparation', 'ready_to_play'],
    ['preparation', 'join'],
  ];

  const isLegal = (from: EventStatus, to: EventStatus) =>
    NON_FOOTBALL_LEGAL.some(([f, t]) => f === from && t === to);

  it('statusesFor lists five states for other sports, six for football', () => {
    expect([...statusesFor(SPORT)]).toEqual([
      'join',
      'ready_to_play',
      'playing',
      'after_match',
      'done',
    ]);
    expect([...statusesFor('football')]).toEqual([...EVENT_STATUSES]);
    // Absent means football: the schema default, and every pre-field document.
    expect([...statusesFor(undefined)]).toEqual([...EVENT_STATUSES]);
    expect([...statusesFor(null)]).toEqual([...EVENT_STATUSES]);
  });

  it('NON_FOOTBALL_EVENT_STATUSES is the exported five-state list', () => {
    expect([...NON_FOOTBALL_EVENT_STATUSES]).not.toContain('preparation');
    expect(NON_FOOTBALL_EVENT_STATUSES).toHaveLength(5);
  });

  // 36 ordered pairs again, this time under a non-football sport.
  describe.each(EVENT_STATUSES)('from %s', (from) => {
    it.each(EVENT_STATUSES)(`-> %s (${SPORT})`, (to) => {
      expect(canTransition(from, to, SPORT)).toBe(isLegal(from, to));
    });
  });

  it('registration closes straight into ready_to_play', () => {
    expect(canTransition('join', 'ready_to_play', SPORT)).toBe(true);
    // ...and preparation cannot be entered from anywhere.
    for (const from of EVENT_STATUSES) {
      expect(canTransition(from, 'preparation', SPORT)).toBe(false);
    }
  });

  it('omitting the sport keeps the football table — the pre-existing callers', () => {
    expect(canTransition('join', 'preparation')).toBe(true);
    expect(canTransition('join', 'ready_to_play')).toBe(false);
  });

  it('allowedTransitions agrees with canTransition per sport', () => {
    for (const from of EVENT_STATUSES) {
      for (const to of EVENT_STATUSES) {
        expect(allowedTransitions(from, SPORT).includes(to)).toBe(
          canTransition(from, to, SPORT),
        );
      }
    }
  });

  it('teams are built in ready_to_play for other sports, preparation for football', () => {
    expect(buildStageFor(SPORT)).toBe('ready_to_play');
    expect(buildStageFor('football')).toBe('preparation');
    expect(buildStageFor(undefined)).toBe('preparation');

    expect(canShuffle('ready_to_play', SPORT)).toBe(true);
    expect(canShuffle('preparation', SPORT)).toBe(false);
    // Football's freeze semantics are untouched.
    expect(canShuffle('ready_to_play', 'football')).toBe(false);
    expect(canShuffle('preparation', 'football')).toBe(true);
  });

  it('shuffle and score entry still never overlap, for either family', () => {
    for (const s of EVENT_STATUSES) {
      expect(canShuffle(s, SPORT) && canEnterScore(s)).toBe(false);
      expect(canShuffle(s, 'football') && canEnterScore(s)).toBe(false);
    }
  });

  it('isFootball treats only a present non-football string as other', () => {
    expect(isFootball('football')).toBe(true);
    expect(isFootball(undefined)).toBe(true);
    expect(isFootball(null)).toBe(true);
    expect(isFootball('badminton')).toBe(false);
    expect(isFootball('padel')).toBe(false);
  });
});
