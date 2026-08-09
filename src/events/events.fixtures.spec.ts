// src/events/events.fixtures.spec.ts
import {
  MAX_TEAMS,
  TEAM_COLOURS,
  computeStandings,
  dealIntoTeams,
  generateFixtures,
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
