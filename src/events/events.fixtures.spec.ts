// src/events/events.fixtures.spec.ts
import {
  MATCH_BUFFER_MINUTES,
  MAX_TEAMS,
  TEAM_COLOURS,
  computeStandings,
  dealIntoTeams,
  generateFixtures,
  generateFixturesLimited,
  generateFixturesFilling,
  matchCountFor,
  shuffled,
} from './events.fixtures';

describe('generateFixtures — double round-robin (spec §4.3.4)', () => {
  // N teams meet twice: N*(N-1) fixtures. 4 -> 12 is the spec's worked example.
  it.each([
    [2, 2],
    [3, 6],
    [4, 12],
    [5, 20],
    [6, 30],
  ])('generates %i teams -> %i fixtures', (teamCount, expected) => {
    const teams = TEAM_COLOURS.slice(0, teamCount) as unknown as string[];
    expect(generateFixtures(teams)).toHaveLength(expected);
  });

  it('gives every team an equal number of matches', () => {
    const teams = ['Red', 'Yellow', 'Blue', 'Black'];
    const fixtures = generateFixtures(teams);

    const played = new Map<string, number>();
    for (const f of fixtures) {
      played.set(f.teamA, (played.get(f.teamA) ?? 0) + 1);
      played.set(f.teamB, (played.get(f.teamB) ?? 0) + 1);
    }

    // 4 teams, double round-robin: each plays the other 3 twice.
    for (const team of teams) expect(played.get(team)).toBe(6);
  });

  it('pairs every combination exactly twice, once each way', () => {
    const teams = ['Red', 'Yellow', 'Blue'];
    const fixtures = generateFixtures(teams);

    const ordered = fixtures.map((f) => `${f.teamA}v${f.teamB}`);
    expect(new Set(ordered).size).toBe(ordered.length); // no literal duplicates

    // Every unordered pair appears twice with home/away swapped.
    for (const [a, b] of [
      ['Red', 'Yellow'],
      ['Red', 'Blue'],
      ['Yellow', 'Blue'],
    ]) {
      expect(ordered).toContain(`${a}v${b}`);
      expect(ordered).toContain(`${b}v${a}`);
    }
  });

  it('numbers matches 1..N with no gaps', () => {
    const fixtures = generateFixtures(['Red', 'Yellow', 'Blue', 'Black']);
    expect(fixtures.map((f) => f.matchNumber)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });

  it('starts every fixture unplayed with null scores, not 0', () => {
    for (const f of generateFixtures(['Red', 'Yellow'])) {
      // 0 is a real scoreline; null is what marks a fixture unplayed.
      expect(f.scoreA).toBeNull();
      expect(f.scoreB).toBeNull();
      expect(f.playedAt).toBeNull();
    }
  });

  it('plays leg 1 in full before leg 2 begins', () => {
    const fixtures = generateFixtures(['Red', 'Yellow', 'Blue']);
    // Leg 1 is the first half; the same pairing must not repeat inside it.
    const leg1 = fixtures.slice(0, 3).map((f) => [f.teamA, f.teamB].sort().join('v'));
    expect(new Set(leg1).size).toBe(3);
  });

  it('returns no fixtures for a single team', () => {
    expect(generateFixtures(['Red'])).toEqual([]);
  });
});

describe('matchCountFor — duration-driven scheduling', () => {
  // The two worked examples from the spec, verbatim.
  it('event 90 min with 30-min matches -> 2', () => {
    expect(matchCountFor(90, 30)).toBe(2); // (90-10)/30 = 2.66 -> 2
  });

  it('event 100 min with 30-min matches -> 3', () => {
    expect(matchCountFor(100, 30)).toBe(3); // (100-10)/30 = 3
  });

  it('reserves the buffer before dividing', () => {
    // Without the 10-minute buffer this would be 3, and the schedule would run
    // to the very end of the booking with no changeover time.
    expect(matchCountFor(90, 30)).toBe(2);
    expect(MATCH_BUFFER_MINUTES).toBe(10);
  });

  it('floors rather than rounding, so a schedule never overruns', () => {
    // 2.9 matches' worth of time must yield 2, not 3.
    expect(matchCountFor(97, 30)).toBe(2);
  });

  it('never schedules more minutes than remain after the buffer', () => {
    for (const eventDuration of [60, 75, 90, 100, 120, 180]) {
      for (const matchDuration of [10, 20, 30, 45, 60]) {
        const count = matchCountFor(eventDuration, matchDuration);
        expect(count * matchDuration).toBeLessThanOrEqual(
          eventDuration - MATCH_BUFFER_MINUTES,
        );
      }
    }
  });

  it('returns 0 when not even one match fits', () => {
    expect(matchCountFor(60, 90)).toBe(0);
    // Exactly the buffer leaves no playable time at all.
    expect(matchCountFor(10, 5)).toBe(0);
  });

  it('returns 0 for nonsensical inputs rather than throwing', () => {
    expect(matchCountFor(0, 30)).toBe(0);
    expect(matchCountFor(90, 0)).toBe(0);
    expect(matchCountFor(-90, 30)).toBe(0);
  });
});

describe('generateFixturesLimited', () => {
  it('caps the fixture list at the limit', () => {
    // 4 teams would be 12 fixtures unlimited.
    expect(generateFixturesLimited(['Red', 'Yellow', 'Blue', 'Black'], 2))
      .toHaveLength(2);
  });

  it('takes a prefix of leg 1, so no team plays a rematch early', () => {
    const teams = ['Red', 'Yellow', 'Blue'];
    const limited = generateFixturesLimited(teams, 3);

    // Leg 1 pairs every combination once before leg 2 begins, so a 3-match
    // schedule over 3 teams contains three DIFFERENT pairings.
    const pairs = limited.map((f) => [f.teamA, f.teamB].sort().join('v'));
    expect(new Set(pairs).size).toBe(3);
  });

  it('numbers the truncated list from 1 with no gaps', () => {
    const limited = generateFixturesLimited(['Red', 'Yellow', 'Blue'], 4);
    expect(limited.map((f) => f.matchNumber)).toEqual([1, 2, 3, 4]);
  });

  it('returns nothing for a zero or negative limit', () => {
    expect(generateFixturesLimited(['Red', 'Yellow'], 0)).toEqual([]);
    expect(generateFixturesLimited(['Red', 'Yellow'], -1)).toEqual([]);
  });

  it('cannot exceed the full round-robin however high the limit', () => {
    // 2 teams meet twice; asking for 10 matches must not invent fixtures.
    expect(generateFixturesLimited(['Red', 'Yellow'], 10)).toHaveLength(2);
  });
});

describe('dealIntoTeams (spec §4.3.3)', () => {
  it('deals round-robin so sizes differ by at most one', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const teams = dealIntoTeams(players, 2);

    expect(teams.map((t) => t.playerIds.length)).toEqual([3, 2]);
    expect(teams.flatMap((t) => t.playerIds).sort()).toEqual(players.sort());
  });

  it('names teams from the colour vocabulary in order', () => {
    const teams = dealIntoTeams(['a', 'b', 'c', 'd'], 4);
    expect(teams.map((t) => t.name)).toEqual([
      'Red',
      'Yellow',
      'Blue',
      'Black',
    ]);
  });

  it('clamps a team count above the colour vocabulary', () => {
    const teams = dealIntoTeams(['a', 'b'], 99);
    expect(teams).toHaveLength(MAX_TEAMS);
  });

  it('never produces fewer than two teams', () => {
    expect(dealIntoTeams(['a', 'b'], 1)).toHaveLength(2);
  });

  it('leaves later teams empty when players run out', () => {
    const teams = dealIntoTeams(['only'], 3);
    expect(teams[0].playerIds).toEqual(['only']);
    expect(teams[1].playerIds).toEqual([]);
  });
});

describe('shuffled', () => {
  it('keeps every element and leaves the input untouched', () => {
    const input = ['a', 'b', 'c', 'd'];
    const out = shuffled(input);

    expect(out.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('computeStandings (spec §4.3, decision #5)', () => {
  it('awards 3 for a win, 1 for a draw, 0 for a loss', () => {
    const table = computeStandings([
      { teamA: 'Red', teamB: 'Blue', scoreA: 2, scoreB: 1 }, // Red win
      { teamA: 'Red', teamB: 'Blue', scoreA: 1, scoreB: 1 }, // draw
    ]);

    const red = table.find((r) => r.team === 'Red')!;
    const blue = table.find((r) => r.team === 'Blue')!;

    expect(red).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0, points: 4 });
    expect(blue).toMatchObject({ played: 2, won: 0, drawn: 1, lost: 1, points: 1 });
  });

  it('skips fixtures with a null score on either side', () => {
    const table = computeStandings([
      { teamA: 'Red', teamB: 'Blue', scoreA: 3, scoreB: 0 },
      { teamA: 'Red', teamB: 'Blue', scoreA: null, scoreB: null },
      { teamA: 'Red', teamB: 'Blue', scoreA: 2, scoreB: null },
    ]);

    // Only the first fixture counts.
    expect(table.find((r) => r.team === 'Red')!.played).toBe(1);
  });

  it('counts a 0-0 draw as played — 0 is a real scoreline', () => {
    const table = computeStandings([
      { teamA: 'Red', teamB: 'Blue', scoreA: 0, scoreB: 0 },
    ]);

    expect(table.find((r) => r.team === 'Red')).toMatchObject({
      played: 1,
      drawn: 1,
      points: 1,
    });
  });

  it('tracks goals for, against and difference', () => {
    const table = computeStandings([
      { teamA: 'Red', teamB: 'Blue', scoreA: 4, scoreB: 1 },
    ]);

    expect(table.find((r) => r.team === 'Red')).toMatchObject({
      goalsFor: 4,
      goalsAgainst: 1,
      goalDifference: 3,
    });
    expect(table.find((r) => r.team === 'Blue')).toMatchObject({
      goalsFor: 1,
      goalsAgainst: 4,
      goalDifference: -3,
    });
  });

  it('orders by points, then goal difference, then goals for, then name', () => {
    const table = computeStandings([
      // Blue and Red both finish on 3 points; Blue has the better difference.
      { teamA: 'Blue', teamB: 'Green', scoreA: 5, scoreB: 0 },
      { teamA: 'Red', teamB: 'Black', scoreA: 1, scoreB: 0 },
    ]);

    expect(table.map((r) => r.team)).toEqual(['Blue', 'Red', 'Black', 'Green']);
  });

  it('breaks a full tie on team name so the order is deterministic', () => {
    const table = computeStandings([
      { teamA: 'Yellow', teamB: 'Red', scoreA: 1, scoreB: 1 },
    ]);

    expect(table.map((r) => r.team)).toEqual(['Red', 'Yellow']);
  });

  it('includes seeded teams that have not played yet', () => {
    const table = computeStandings([], ['Red', 'Blue']);

    expect(table).toHaveLength(2);
    expect(table[0]).toMatchObject({ played: 0, points: 0, goalDifference: 0 });
  });

  it('returns an empty table when there is nothing to fold', () => {
    expect(computeStandings([])).toEqual([]);
  });
});

describe('generateFixturesFilling — repeat the round-robin to fill the slot', () => {
  const TEAMS = ['Red', 'Yellow', 'Blue'];

  it('reproduces the reported case: 2h event, 10-min matches -> 11', () => {
    // 120 minutes minus the 10-minute buffer is 110 playable, so 11 slots.
    // A 3-team round-robin is only 6, which is what used to be returned.
    const fixtures = generateFixturesFilling(TEAMS, matchCountFor(120, 10));
    expect(fixtures).toHaveLength(11);
  });

  it('cycles the round-robin rather than inventing pairings', () => {
    const base = generateFixtures(TEAMS);
    const filled = generateFixturesFilling(TEAMS, 8);

    // Slot 7 repeats slot 1, slot 8 repeats slot 2.
    expect(filled[6].teamA).toBe(base[0].teamA);
    expect(filled[6].teamB).toBe(base[0].teamB);
    expect(filled[7].teamA).toBe(base[1].teamA);
  });

  it('numbers every slot contiguously from 1', () => {
    const filled = generateFixturesFilling(TEAMS, 11);
    expect(filled.map((f) => f.matchNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('never returns fewer than one full round-robin', () => {
    // A short event must not silently drop half the schedule — that was the
    // truncation bug. The floor is the round-robin, the ceiling is the slot.
    expect(generateFixturesFilling(TEAMS, 2)).toHaveLength(6);
    expect(generateFixturesFilling(TEAMS, 0)).toHaveLength(6);
    expect(generateFixturesFilling(TEAMS, -5)).toHaveLength(6);
  });

  it('leaves every fixture unplayed', () => {
    for (const f of generateFixturesFilling(TEAMS, 11)) {
      expect(f.scoreA).toBeNull();
      expect(f.scoreB).toBeNull();
      expect(f.playedAt).toBeNull();
    }
  });

  it('returns nothing when there is no pairing to make', () => {
    expect(generateFixturesFilling(['Red'], 10)).toEqual([]);
    expect(generateFixturesFilling([], 10)).toEqual([]);
  });

  it('keeps two teams alternating home and away', () => {
    const filled = generateFixturesFilling(['Red', 'Blue'], 5);
    expect(filled).toHaveLength(5);
    expect(filled[0].teamA).toBe('Red');
    expect(filled[1].teamA).toBe('Blue');
    expect(filled[2].teamA).toBe('Red');
  });
});
