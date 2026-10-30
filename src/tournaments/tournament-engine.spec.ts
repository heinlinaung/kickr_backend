import {
  bracketOrder,
  computeStandings,
  formatPreview,
  groupSizes,
  normalizeSettings,
  orderForRest,
  qualify,
  randomDraw,
  rankAcrossGroups,
  ResultLine,
  roundName,
  roundRobin,
  seedBracket,
  seededDraw,
  suggestSetups,
  validateBracketOrder,
  validateSettings,
} from './tournament-engine';
import { DEFAULT_LEAGUE } from './tournament.constants';

const POINTS = DEFAULT_LEAGUE.points;
const TB = DEFAULT_LEAGUE.tiebreakers;

/** A seeded rng so draws are repeatable. */
function rng(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function r(
  home: string,
  away: string,
  homeGoals: number,
  awayGoals: number,
  cards: [number, number] = [0, 0],
): ResultLine {
  return {
    home,
    away,
    homeGoals,
    awayGoals,
    homeCards: cards[0],
    awayCards: cards[1],
  };
}

describe('tournament engine', () => {
  describe('basics', () => {
    it('splits teams evenly, earlier groups take extras', () => {
      expect(groupSizes(10, 3)).toEqual([4, 3, 3]);
      expect(groupSizes(12, 4)).toEqual([3, 3, 3, 3]);
    });

    it('names rounds by teams left', () => {
      expect([32, 16, 8, 4, 2].map(roundName)).toEqual([
        'Round of 32',
        'Round of 16',
        'Quarter-final',
        'Semi-final',
        'Final',
      ]);
    });

    it('orders a bracket so seeds 1 and 2 meet only in the final', () => {
      expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
      expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    });
  });

  describe('settings', () => {
    it('omits league for KNOCKOUT and qualification/knockout for LEAGUE', () => {
      expect(Object.keys(normalizeSettings('KNOCKOUT'))).toEqual(['knockout']);
      expect(Object.keys(normalizeSettings('LEAGUE'))).toEqual(['league']);
      expect(Object.keys(normalizeSettings('LEAGUE_KNOCKOUT'))).toEqual([
        'league',
        'qualification',
        'knockout',
      ]);
    });

    it('rejects more groups than teams allow and fewer than 2 qualifiers', () => {
      const s = normalizeSettings('LEAGUE_KNOCKOUT', {
        league: { groupCount: 5 },
      });
      expect(validateSettings('LEAGUE_KNOCKOUT', s, 8)).toMatch(
        /at least 10 teams/,
      );
      const one = normalizeSettings('LEAGUE_KNOCKOUT', {
        qualification: { qualifyPerGroup: 1 },
      });
      expect(validateSettings('LEAGUE_KNOCKOUT', one, 6)).toMatch(
        /fewer than 2 qualifiers/,
      );
    });

    it('rejects best of rest with no team below the cut', () => {
      const s = normalizeSettings('LEAGUE_KNOCKOUT', {
        league: { groupCount: 4 },
        qualification: { qualifyPerGroup: 3, bestOfRest: 2 },
      });
      expect(validateSettings('LEAGUE_KNOCKOUT', s, 12)).toMatch(
        /doesn't fit groups of 3/,
      );
    });

    it.each([
      [6, 1, 4, 0, 15, 3, 'Semi-final'],
      [8, 2, 2, 0, 12, 3, 'Semi-final'],
      [10, 2, 2, 0, 20, 3, 'Semi-final'],
      [12, 4, 2, 0, 12, 7, 'Quarter-final'],
      [12, 3, 2, 2, 18, 7, 'Quarter-final'],
      [16, 4, 2, 0, 24, 7, 'Quarter-final'],
      [24, 6, 2, 4, 36, 15, 'Round of 16'],
    ])(
      'previews the recommended %i-team setup',
      (teams, groupCount, q, b, league, knockout, startsAt) => {
        const s = normalizeSettings('LEAGUE_KNOCKOUT', {
          league: { groupCount },
          qualification: { qualifyPerGroup: q, bestOfRest: b },
        });
        expect(validateSettings('LEAGUE_KNOCKOUT', s, teams)).toBeNull();
        const p = formatPreview('LEAGUE_KNOCKOUT', s, teams);
        expect(p.matches).toEqual({
          league,
          knockout,
          total: league + knockout,
        });
        expect(p.knockoutStartsAt).toBe(startsAt);
      },
    );

    it('counts a third-place match and second legs', () => {
      const s = normalizeSettings('KNOCKOUT', {
        knockout: { thirdPlaceMatch: true, legs: 2 },
      });
      // 8 teams: 7 ties, 6 of them two-legged (not the final), plus third place.
      expect(formatPreview('KNOCKOUT', s, 8).matches.knockout).toBe(7 + 6 + 1);
    });

    it('sizes a knockout-only bracket up with byes', () => {
      const p = formatPreview('KNOCKOUT', normalizeSettings('KNOCKOUT'), 6);
      expect(p).toMatchObject({ byes: 2, knockoutStartsAt: 'Quarter-final' });
      expect(
        formatPreview('KNOCKOUT', normalizeSettings('KNOCKOUT'), 12).byes,
      ).toBe(4);
    });

    it('suggests both 12-team setups', () => {
      expect(suggestSetups(12)).toHaveLength(2);
      expect(suggestSetups(7)).toEqual([]);
    });
  });

  describe('group draw', () => {
    const teams = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      clubId: null,
    }));

    it('random draw: 10 teams into 3 groups is 4,3,3 with every team once', () => {
      const groups = randomDraw(teams, 3, false, rng());
      expect(groups.map((g) => g.length)).toEqual([4, 3, 3]);
      expect(new Set(groups.flat().map((t) => t.id)).size).toBe(10);
    });

    it('keeps club-mates apart when the numbers allow', () => {
      const clubbed = teams
        .slice(0, 8)
        .map((t, i) => ({ ...t, clubId: i < 2 ? 'c1' : i < 4 ? 'c2' : null }));
      for (let seed = 1; seed < 20; seed++) {
        const groups = randomDraw(clubbed, 2, true, rng(seed));
        for (const g of groups) {
          const clubs = g
            .map((t) => clubbed.find((c) => c.id === t.id)!.clubId)
            .filter(Boolean);
          expect(new Set(clubs).size).toBe(clubs.length);
        }
      }
    });

    it('seeded draw gives each group one team per pot', () => {
      const pots = [
        ['t0', 't1'],
        ['t2', 't3'],
        ['t4', 't5'],
        ['t6', 't7'],
      ];
      const groups = seededDraw(teams.slice(0, 8), pots, 2, false, rng());
      for (const g of groups) {
        expect(g.map((t) => t.pot).sort()).toEqual([1, 2, 3, 4]);
      }
    });
  });

  describe('fixtures', () => {
    it.each([
      [4, 6, 3],
      [5, 10, 5],
      [6, 15, 5],
    ])(
      'a group of %i plays %i matches over %i matchdays, each pair once',
      (n, matches, days) => {
        const ids = Array.from({ length: n }, (_, i) => `t${i}`);
        const fx = roundRobin(ids);
        expect(fx).toHaveLength(matches);
        expect(
          new Set(fx.map((f) => [f.home, f.away].sort().join())).size,
        ).toBe(matches);
        expect(Math.max(...fx.map((f) => f.matchday))).toBe(days);
        // Nobody plays twice on one matchday.
        for (let d = 1; d <= days; d++) {
          const playing = fx
            .filter((f) => f.matchday === d)
            .flatMap((f) => [f.home, f.away]);
          expect(new Set(playing).size).toBe(playing.length);
        }
      },
    );

    it('an odd group rests one team per round', () => {
      const fx = roundRobin(['a', 'b', 'c', 'd', 'e']);
      for (let d = 1; d <= 5; d++)
        expect(fx.filter((f) => f.matchday === d)).toHaveLength(2);
    });

    it('double round-robin swaps home and away', () => {
      const fx = roundRobin(['a', 'b', 'c', 'd'], true);
      expect(fx).toHaveLength(12);
      const homes = (x: string, y: string) =>
        fx.filter((f) => f.home === x && f.away === y).length;
      expect(homes('a', 'b') + homes('b', 'a')).toBe(2);
      expect(homes('a', 'b')).toBe(1);
    });

    it('orders two groups so no team plays twice in a row', () => {
      const fx = [
        ...roundRobin(['a1', 'a2', 'a3', 'a4']),
        ...roundRobin(['b1', 'b2', 'b3', 'b4']),
      ];
      const ordered = orderForRest(fx);
      expect(ordered).toHaveLength(12);
      for (let i = 1; i < ordered.length; i++) {
        const prev = [ordered[i - 1].home, ordered[i - 1].away];
        expect(prev).not.toContain(ordered[i].home);
        expect(prev).not.toContain(ordered[i].away);
      }
    });
  });

  describe('standings', () => {
    it('counts played, won, drawn, lost, goals and points', () => {
      const { rows } = computeStandings(
        ['a', 'b', 'c'],
        [r('a', 'b', 2, 0), r('b', 'c', 1, 1), r('c', 'a', 0, 3)],
        POINTS,
        TB,
      );
      expect(rows[0]).toMatchObject({
        teamId: 'a',
        played: 2,
        won: 2,
        points: 6,
        goalsFor: 5,
        goalDiff: 5,
        rank: 1,
      });
      expect(rows.map((x) => x.points)).toEqual([6, 1, 1]);
    });

    it('breaks a points tie on head-to-head before goal difference', () => {
      // b beat c, though c has the better overall goal difference.
      const results = [
        r('b', 'c', 1, 0),
        r('a', 'c', 0, 5),
        r('a', 'b', 1, 0),
        r('c', 'd', 9, 0),
        r('b', 'd', 1, 0),
        r('a', 'd', 0, 1),
      ];
      const { rows, ties } = computeStandings(
        ['a', 'b', 'c', 'd'],
        results,
        POINTS,
        TB,
      );
      expect(rows.map((x) => x.teamId).slice(0, 2)).toEqual(['b', 'c']);
      expect(ties).toEqual([]);
    });

    it('re-applies head-to-head to the teams still level', () => {
      // a, b, c on 3 points in a three-way cycle with equal h2h; overall GD splits a off.
      const results = [
        r('a', 'b', 1, 0),
        r('b', 'c', 1, 0),
        r('c', 'a', 1, 0),
        r('a', 'd', 0, 0),
        r('b', 'd', 0, 0),
        r('c', 'd', 0, 0),
      ];
      const out = computeStandings(['a', 'b', 'c', 'd'], results, POINTS, TB);
      expect(out.ties).toEqual([['a', 'b', 'c']]);
      expect(out.rows.slice(0, 3).every((x) => x.tied)).toBe(true);
    });

    it('uses fair play, then an organizer ruling (lots)', () => {
      const results = [r('a', 'b', 1, 1, [2, 0])];
      expect(
        computeStandings(['a', 'b'], results, POINTS, TB).rows[0].teamId,
      ).toBe('b');
      const level = [r('a', 'b', 1, 1)];
      expect(computeStandings(['a', 'b'], level, POINTS, TB).ties).toEqual([
        ['a', 'b'],
      ]);
      const ruled = computeStandings(['a', 'b'], level, POINTS, TB, [
        { order: ['b', 'a'] },
      ]);
      expect(ruled.ties).toEqual([]);
      expect(ruled.rows.map((x) => x.teamId)).toEqual(['b', 'a']);
    });

    it('honours a reordered tiebreaker list', () => {
      // b scored more, a has the better goal difference.
      const results = [
        r('a', 'c', 1, 0),
        r('b', 'c', 3, 3),
        r('a', 'b', 0, 0),
        r('c', 'b', 0, 1),
      ];
      const order = computeStandings(['a', 'b', 'c'], results, POINTS, [
        'GOALS_FOR',
        'GOAL_DIFF',
      ]);
      expect(order.rows[0].teamId).toBe('b');
    });
  });

  describe('across groups', () => {
    it('drops results against the bottom team of a bigger group', () => {
      const big = {
        groupId: 'A',
        name: 'A',
        ranked: ['a1', 'a2', 'a3', 'a4'],
        // a3 only got its points from beating the last-placed a4.
        results: [
          r('a3', 'a4', 5, 0),
          r('a1', 'a3', 1, 0),
          r('a2', 'a3', 1, 0),
        ],
      };
      const small = {
        groupId: 'B',
        name: 'B',
        ranked: ['b1', 'b2', 'b3'],
        results: [r('b3', 'b1', 1, 1), r('b2', 'b3', 1, 1)],
      };
      const out = rankAcrossGroups(['a3', 'b3'], [big, small], POINTS, TB);
      expect(out.rows.map((x) => x.teamId)).toEqual(['b3', 'a3']);
      expect(out.rows.find((x) => x.teamId === 'a3')!.played).toBe(2);
    });
  });

  describe('qualification and seeding', () => {
    const group = (
      id: string,
      ranked: string[],
      results: ResultLine[] = [],
    ) => ({
      groupId: id,
      name: id,
      ranked,
      results,
      ties: [] as string[][],
    });

    it('example 1: 2 groups of 4, top 2 cross-group → A1 v B2, B1 v A2', () => {
      const A = group('A', ['red', 'blue', 'aura', 'stars']);
      const B = group('B', ['warriors', 'lions', 'tigers', 'eagles']);
      const out = qualify({
        groups: [A, B],
        qualifyPerGroup: 2,
        bestOfRest: 0,
        seeding: 'CROSS_GROUP',
        points: POINTS,
        tiebreakers: TB,
        resolutions: [],
      });
      expect(out.qualifiers.map((q) => q.seedLabel)).toEqual([
        'A1',
        'B1',
        'A2',
        'B2',
      ]);
      const seeds = out.qualifiers.map((q) => ({
        teamId: q.teamId,
        groupId: q.groupId,
        tier: q.tier,
      }));
      const { slots, clashes } = seedBracket(seeds, true);
      expect(slots).toEqual(['red', 'lions', 'warriors', 'blue']);
      expect(clashes).toEqual([]);
    });

    it('fixes a same-group pair by swapping opponents', () => {
      // Runners-up ranked so the weakest one is A2: seed order A1, B1, B2, A2.
      const seeds = [
        { teamId: 'A1', groupId: 'A', tier: 0 },
        { teamId: 'B1', groupId: 'B', tier: 0 },
        { teamId: 'B2', groupId: 'B', tier: 1 },
        { teamId: 'A2', groupId: 'A', tier: 1 },
      ];
      expect(seedBracket(seeds, true).slots).toEqual(['A1', 'B2', 'B1', 'A2']);
      expect(seedBracket(seeds, false).slots).toEqual(['A1', 'A2', 'B1', 'B2']);
    });

    it('example 2: 3 groups of 4 with the 2 best thirds', () => {
      // Winners' records: A > B > C. Runners-up: A > B > C. Thirds: A > B > C.
      const win = (t: string, opp: string, n: number) =>
        Array.from({ length: n }, () => r(t, opp, 1, 0));
      const mk = (g: string, w: number, ru: number, th: number) =>
        group(
          g,
          [`${g}1`, `${g}2`, `${g}3`, `${g}4`],
          [
            ...win(`${g}1`, `${g}4`, w),
            ...win(`${g}2`, `${g}4`, ru),
            ...win(`${g}3`, `${g}4`, th),
          ],
        );
      // Wins count against the bottom team, so they survive normalization only via
      // the 4th team — equal sizes here, so nothing is dropped.
      const groups = [mk('A', 3, 3, 3), mk('B', 2, 2, 2), mk('C', 1, 1, 1)];
      const out = qualify({
        groups,
        qualifyPerGroup: 2,
        bestOfRest: 2,
        seeding: 'CROSS_GROUP',
        points: POINTS,
        tiebreakers: TB,
        resolutions: [],
      });
      expect(out.ties).toEqual([]);
      expect(out.qualifiers.map((q) => q.seedLabel)).toEqual([
        'A1',
        'B1',
        'C1',
        'A2',
        'B2',
        'C2',
        'A3',
        'B3',
      ]);
      const seeds = out.qualifiers.map((q) => ({
        teamId: q.teamId,
        groupId: q.groupId,
        tier: q.tier,
      }));
      const { slots, clashes } = seedBracket(seeds, true);
      const pairs = [0, 1, 2, 3].map((p) => [slots[2 * p], slots[2 * p + 1]]);
      // Best winner meets the weaker third, the second winner the other third.
      expect(pairs).toContainEqual(['A1', 'B3']);
      expect(pairs).toContainEqual(['B1', 'A3']);
      expect(pairs).toContainEqual(['C1', 'B2']);
      expect(pairs).toContainEqual(['A2', 'C2']);
      expect(clashes).toEqual([]);
    });

    it('example 3: one table of 6, top 4 ranked 1v4 and 2v3', () => {
      const out = qualify({
        groups: [group('L', ['a', 'b', 'c', 'd', 'e', 'f'])],
        qualifyPerGroup: 4,
        bestOfRest: 0,
        seeding: 'RANKED',
        points: POINTS,
        tiebreakers: TB,
        resolutions: [],
      });
      expect(out.qualifiers.map((q) => q.seedLabel)).toEqual([
        '1',
        '2',
        '3',
        '4',
      ]);
      const seeds = out.qualifiers.map((q) => ({
        teamId: q.teamId,
        groupId: q.groupId,
        tier: q.tier,
      }));
      expect(seedBracket(seeds, false).slots).toEqual(['a', 'd', 'b', 'c']);
    });

    it('blocks on a tie at the qualifying cut, not below it', () => {
      const A = {
        ...group('A', ['a1', 'a2', 'a3', 'a4']),
        ties: [['a2', 'a3']],
      };
      const B = {
        ...group('B', ['b1', 'b2', 'b3', 'b4']),
        ties: [['b3', 'b4']],
      };
      const out = qualify({
        groups: [A, B],
        qualifyPerGroup: 2,
        bestOfRest: 0,
        seeding: 'CROSS_GROUP',
        points: POINTS,
        tiebreakers: TB,
        resolutions: [],
      });
      expect(out.ties).toEqual([
        expect.objectContaining({ teamIds: ['a2', 'a3'], groupId: 'A' }),
      ]);
    });

    it('6 qualifiers give the top 2 seeds byes', () => {
      const seeds = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => ({
        teamId: id,
        groupId: null,
        tier: 0,
      }));
      const { slots } = seedBracket(seeds, false);
      expect(slots).toEqual(['s1', null, 's4', 's5', 's2', null, 's3', 's6']);
    });
  });

  describe('manual bracket order', () => {
    it('needs every team once, the right size, and no double byes', () => {
      const ids = ['a', 'b', 'c'];
      expect(validateBracketOrder(['a', 'b', 'c', null], ids)).toBeNull();
      expect(validateBracketOrder(['a', 'b', 'c'], ids)).toMatch(/4 positions/);
      expect(validateBracketOrder(['a', 'a', 'c', null], ids)).toMatch(/twice/);
      expect(validateBracketOrder([null, null, 'a', 'b'], ['a', 'b'])).toMatch(
        /2 positions/,
      );
    });
  });
});
