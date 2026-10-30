// src/tournaments/tournament-engine.ts
/**
 * Tournament formats — the pure half.
 *
 * Group draws, round-robin fixtures, standings and tiebreakers, qualification
 * and bracket seeding, as total functions over plain ids and numbers. No
 * Mongoose, no Nest: TournamentPhasesService owns persistence, this module
 * owns the rules, so every rule can be unit-tested without a database.
 */
import {
  DEFAULT_KNOCKOUT,
  DEFAULT_LEAGUE,
  DEFAULT_QUALIFICATION,
  KnockoutSettings,
  LeagueSettings,
  PointsSettings,
  QualificationSettings,
  RED_CARD_POINTS,
  Seeding,
  Tiebreaker,
  TournamentFormat,
  TournamentSettings,
  YELLOW_CARD_POINTS,
} from './tournament.constants';

export type Rng = () => number;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Fisher–Yates; `rng` is injectable so tests can pin the draw. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 0 -> A, 1 -> B, … 25 -> Z, 26 -> AA. */
export function groupName(index: number): string {
  let name = '';
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/** Splits teams as evenly as possible; earlier groups take the extras. 10/3 -> 4,3,3. */
export function groupSizes(teamCount: number, groupCount: number): number[] {
  if (groupCount < 1) return [];
  const base = Math.floor(teamCount / groupCount);
  const extra = teamCount % groupCount;
  return Array.from(
    { length: groupCount },
    (_, i) => base + (i < extra ? 1 : 0),
  );
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Round names come from the number of teams left in the round. */
export function roundName(teamsLeft: number): string {
  if (teamsLeft === 2) return 'Final';
  if (teamsLeft === 4) return 'Semi-final';
  if (teamsLeft === 8) return 'Quarter-final';
  return `Round of ${teamsLeft}`;
}

/**
 * Seed number at each bracket position, so that seed 1 and seed 2 can only
 * meet in the final. Consecutive positions form a first-round match, the
 * higher seed first: 8 -> [1,8, 4,5, 2,7, 3,6].
 */
export function bracketOrder(size: number): number[] {
  let order = [1];
  for (let n = 2; n <= size; n *= 2) {
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function cardPoints(cards?: { yellow?: number; red?: number } | null) {
  return (
    (cards?.yellow ?? 0) * YELLOW_CARD_POINTS +
    (cards?.red ?? 0) * RED_CARD_POINTS
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface FormatInput {
  league?: Partial<LeagueSettings> | null;
  qualification?: Partial<QualificationSettings> | null;
  knockout?: Partial<KnockoutSettings> | null;
}

/**
 * Fills defaults and drops the parts a format doesn't use: `league` is
 * omitted for KNOCKOUT, `qualification` and `knockout` for LEAGUE.
 */
export function normalizeSettings(
  format: TournamentFormat,
  input: FormatInput = {},
): TournamentSettings {
  const settings: TournamentSettings = {};
  if (format !== 'KNOCKOUT') {
    const l = input.league ?? {};
    settings.league = {
      ...DEFAULT_LEAGUE,
      ...stripUndefined(l),
      points: { ...DEFAULT_LEAGUE.points, ...stripUndefined(l.points ?? {}) },
      tiebreakers: l.tiebreakers
        ? [...l.tiebreakers]
        : [...DEFAULT_LEAGUE.tiebreakers],
      teamsPerGroup: l.teamsPerGroup ?? null,
    };
  }
  if (format === 'LEAGUE_KNOCKOUT') {
    settings.qualification = {
      ...DEFAULT_QUALIFICATION,
      ...stripUndefined(input.qualification ?? {}),
    };
  }
  if (format !== 'LEAGUE') {
    settings.knockout = {
      ...DEFAULT_KNOCKOUT,
      ...stripUndefined(input.knockout ?? {}),
    };
  }
  return settings;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Returns why the settings can't work for `teamCount` teams, or null. */
export function validateSettings(
  format: TournamentFormat,
  s: TournamentSettings,
  teamCount: number,
): string | null {
  const l = s.league;
  if (l) {
    if (!Number.isInteger(l.groupCount) || l.groupCount < 1) {
      return 'groupCount must be at least 1';
    }
    if (new Set(l.tiebreakers).size !== l.tiebreakers.length) {
      return 'tiebreakers must not repeat';
    }
    if (teamCount >= 2 && l.groupCount * 2 > teamCount) {
      return `${l.groupCount} groups need at least ${l.groupCount * 2} teams (2 per group); there are ${teamCount}`;
    }
    if (l.teamsPerGroup != null && l.groupCount * l.teamsPerGroup < teamCount) {
      return `${l.groupCount} groups of ${l.teamsPerGroup} can't hold ${teamCount} teams`;
    }
  }
  const q = s.qualification;
  if (format === 'LEAGUE_KNOCKOUT' && l && q) {
    if (l.groupCount === 1 && q.bestOfRest > 0) {
      return 'bestOfRest needs more than one group';
    }
    if (q.bestOfRest > l.groupCount) {
      return 'bestOfRest can be at most one team per group';
    }
    const qualifiers = l.groupCount * q.qualifyPerGroup + q.bestOfRest;
    if (qualifiers < 2) return 'fewer than 2 qualifiers';
    if (teamCount >= 2) {
      const smallest = Math.min(...groupSizes(teamCount, l.groupCount));
      const needed = q.qualifyPerGroup + (q.bestOfRest > 0 ? 1 : 0);
      if (needed > smallest) {
        return `qualifyPerGroup ${q.qualifyPerGroup}${q.bestOfRest ? ' plus best of rest' : ''} doesn't fit groups of ${smallest}`;
      }
    }
  }
  return null;
}

export interface FormatPreview {
  teamCount: number;
  groups: number;
  teamsPerGroup: number[];
  qualifiers: number;
  byes: number;
  matches: { league: number; knockout: number; total: number };
  knockoutStartsAt: string | null;
}

export function formatPreview(
  format: TournamentFormat,
  s: TournamentSettings,
  teamCount: number,
): FormatPreview {
  const sizes = s.league ? groupSizes(teamCount, s.league.groupCount) : [];
  const legsFactor = s.league?.roundRobin === 'DOUBLE' ? 2 : 1;
  const league =
    sizes.reduce((sum, n) => sum + (n * (n - 1)) / 2, 0) * legsFactor;

  let qualifiers = 0;
  if (format === 'KNOCKOUT') qualifiers = teamCount;
  if (format === 'LEAGUE_KNOCKOUT' && s.league && s.qualification) {
    qualifiers =
      s.league.groupCount * s.qualification.qualifyPerGroup +
      s.qualification.bestOfRest;
  }
  const bracket = qualifiers >= 2 ? nextPowerOfTwo(qualifiers) : 0;
  let knockout = 0;
  if (bracket) {
    const ties = qualifiers - 1;
    knockout = ties + (s.knockout?.legs === 2 ? Math.max(0, ties - 1) : 0);
    if (s.knockout?.thirdPlaceMatch && bracket >= 4) knockout += 1;
  }
  return {
    teamCount,
    groups: sizes.length,
    teamsPerGroup: sizes,
    qualifiers,
    byes: bracket ? bracket - qualifiers : 0,
    matches: { league, knockout, total: league + knockout },
    knockoutStartsAt: bracket ? roundName(bracket) : null,
  };
}

/** The recommended mixed setups, by team count. */
export const RECOMMENDED_SETUPS = [
  {
    teams: 6,
    groupCount: 1,
    qualifyPerGroup: 4,
    bestOfRest: 0,
    seeding: 'RANKED',
  },
  {
    teams: 8,
    groupCount: 2,
    qualifyPerGroup: 2,
    bestOfRest: 0,
    seeding: 'CROSS_GROUP',
  },
  {
    teams: 10,
    groupCount: 2,
    qualifyPerGroup: 2,
    bestOfRest: 0,
    seeding: 'CROSS_GROUP',
  },
  {
    teams: 12,
    groupCount: 4,
    qualifyPerGroup: 2,
    bestOfRest: 0,
    seeding: 'CROSS_GROUP',
  },
  {
    teams: 12,
    groupCount: 3,
    qualifyPerGroup: 2,
    bestOfRest: 2,
    seeding: 'CROSS_GROUP',
  },
  {
    teams: 16,
    groupCount: 4,
    qualifyPerGroup: 2,
    bestOfRest: 0,
    seeding: 'CROSS_GROUP',
  },
  {
    teams: 24,
    groupCount: 6,
    qualifyPerGroup: 2,
    bestOfRest: 4,
    seeding: 'CROSS_GROUP',
  },
] as const;

export function suggestSetups(teamCount: number) {
  return RECOMMENDED_SETUPS.filter((r) => r.teams === teamCount).map((r) => {
    const settings = normalizeSettings('LEAGUE_KNOCKOUT', {
      league: { groupCount: r.groupCount },
      qualification: {
        qualifyPerGroup: r.qualifyPerGroup,
        bestOfRest: r.bestOfRest,
        seeding: r.seeding as Seeding,
      },
    });
    return {
      format: 'LEAGUE_KNOCKOUT' as const,
      league: { groupCount: r.groupCount },
      qualification: settings.qualification,
      preview: formatPreview('LEAGUE_KNOCKOUT', settings, teamCount),
    };
  });
}

// ---------------------------------------------------------------------------
// Group draw
// ---------------------------------------------------------------------------

export interface DrawTeam {
  id: string;
  /** The Group (club) the team comes from, for `separateSameClub`. */
  clubId: string | null;
}

export interface DrawnTeam {
  id: string;
  pot: number | null;
}

function clubClashes(
  group: DrawnTeam[],
  team: DrawTeam,
  clubOf: Map<string, string | null>,
) {
  if (!team.clubId) return 0;
  return group.filter((t) => clubOf.get(t.id) === team.clubId).length;
}

/**
 * Random draw into `groupCount` groups as evenly as possible. With
 * `separateSameClub`, teams from the busiest clubs are placed first, each
 * into the open group holding the fewest of its club-mates.
 */
export function randomDraw(
  teams: DrawTeam[],
  groupCount: number,
  separateSameClub: boolean,
  rng: Rng = Math.random,
): DrawnTeam[][] {
  const sizes = groupSizes(teams.length, groupCount);
  const shuffled = shuffle(teams, rng);
  const groups: DrawnTeam[][] = sizes.map(() => []);
  if (!separateSameClub) {
    let i = 0;
    sizes.forEach((size, g) => {
      for (let k = 0; k < size; k++)
        groups[g].push({ id: shuffled[i++].id, pot: null });
    });
    return groups;
  }
  const clubOf = new Map(teams.map((t) => [t.id, t.clubId]));
  const clubSize = new Map<string, number>();
  for (const t of teams)
    if (t.clubId) clubSize.set(t.clubId, (clubSize.get(t.clubId) ?? 0) + 1);
  const ordered = [...shuffled].sort(
    (a, b) =>
      (clubSize.get(b.clubId ?? '') ?? 0) - (clubSize.get(a.clubId ?? '') ?? 0),
  );
  for (const team of ordered) {
    const open = groups
      .map((g, i) => ({ g, i }))
      .filter(({ g, i }) => g.length < sizes[i]);
    const best = shuffle(open, rng).sort(
      (a, b) =>
        clubClashes(a.g, team, clubOf) - clubClashes(b.g, team, clubOf) ||
        sizes[b.i] - b.g.length - (sizes[a.i] - a.g.length),
    )[0];
    best.g.push({ id: team.id, pot: null });
  }
  return groups;
}

/**
 * Seeded draw: `pots[0]` is the strongest. Each group gets at most one team
 * per pot; pots smaller than the group count leave some groups a team short.
 */
export function seededDraw(
  teams: DrawTeam[],
  pots: string[][],
  groupCount: number,
  separateSameClub: boolean,
  rng: Rng = Math.random,
): DrawnTeam[][] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const clubOf = new Map(teams.map((t) => [t.id, t.clubId]));
  const groups: DrawnTeam[][] = Array.from({ length: groupCount }, () => []);
  pots.forEach((pot, potIndex) => {
    const taken = new Set<number>();
    for (const id of shuffle(pot, rng)) {
      const team = byId.get(id)!;
      const open = groups
        .map((g, i) => ({ g, i }))
        .filter(({ i }) => !taken.has(i));
      const best = shuffle(open, rng).sort(
        (a, b) =>
          (separateSameClub
            ? clubClashes(a.g, team, clubOf) - clubClashes(b.g, team, clubOf)
            : 0) || a.g.length - b.g.length,
      )[0];
      taken.add(best.i);
      best.g.push({ id, pot: potIndex + 1 });
    }
  });
  return groups;
}

/** Every team exactly once, no unknown ids. Returns an error message or null. */
export function validatePartition(
  label: string,
  parts: string[][],
  teamIds: string[],
): string | null {
  const known = new Set(teamIds);
  const seen = new Set<string>();
  for (const id of parts.flat()) {
    if (!known.has(id)) return `${label}: ${id} is not an approved team`;
    if (seen.has(id)) return `${label}: ${id} appears twice`;
    seen.add(id);
  }
  if (seen.size !== known.size)
    return `${label} must include every approved team`;
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface Fixture {
  matchday: number;
  home: string;
  away: string;
}

/**
 * Round-robin by the circle method: team 0 stays put and the rest rotate.
 * An odd group gets a phantom team, and whoever meets it rests that round.
 * DOUBLE repeats the schedule with home and away swapped.
 */
export function roundRobin(teamIds: string[], double = false): Fixture[] {
  const slots: (string | null)[] = [...teamIds];
  if (slots.length % 2) slots.push(null);
  const n = slots.length;
  const out: Fixture[] = [];
  let arr = slots;
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === null || b === null) continue;
      // Alternate home and away so nobody hosts every match.
      const flip = i === 0 ? r % 2 === 1 : (r + i) % 2 === 1;
      out.push({ matchday: r + 1, home: flip ? b : a, away: flip ? a : b });
    }
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  if (double) {
    const rounds = n - 1;
    out.push(
      ...out.map((f) => ({
        matchday: f.matchday + rounds,
        home: f.away,
        away: f.home,
      })),
    );
  }
  return out;
}

/**
 * Play order on one pitch: matchday by matchday, picking next a match with
 * neither team from the previous one. If the current matchday has none, a
 * clash-free match from the next matchday is pulled forward; otherwise the
 * back-to-back is unavoidable and the first remaining match is taken.
 */
export function orderForRest<T extends Fixture>(fixtures: T[]): T[] {
  const remaining = [...fixtures].sort((a, b) => a.matchday - b.matchday);
  const out: T[] = [];
  let prev: T | null = null;
  const rests = (f: T) =>
    !prev ||
    (f.home !== prev.home &&
      f.home !== prev.away &&
      f.away !== prev.home &&
      f.away !== prev.away);
  while (remaining.length) {
    const day = remaining[0].matchday;
    let idx = remaining.findIndex((f) => f.matchday === day && rests(f));
    if (idx === -1)
      idx = remaining.findIndex((f) => f.matchday === day + 1 && rests(f));
    if (idx === -1) idx = 0;
    prev = remaining.splice(idx, 1)[0];
    out.push(prev);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface ResultLine {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  /** Fair-play points (see cardPoints). */
  homeCards: number;
  awayCards: number;
}

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  fairPlay: number;
  rank: number;
  /** Level with another team after every tiebreaker. */
  tied: boolean;
}

/** An organizer's decision for a tie no tiebreaker could break. */
export interface TieResolution {
  /** The tied teams, best first. */
  order: string[];
}

function emptyRow(teamId: string): StandingRow {
  return {
    teamId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    fairPlay: 0,
    rank: 0,
    tied: false,
  };
}

/** Rows for `teamIds` over the results between them (others ignored). */
export function tally(
  teamIds: string[],
  results: ResultLine[],
  points: PointsSettings,
): Map<string, StandingRow> {
  const rows = new Map(teamIds.map((id) => [id, emptyRow(id)]));
  for (const r of results) {
    const home = rows.get(r.home);
    const away = rows.get(r.away);
    for (const [row, gf, ga, cards] of [
      [home, r.homeGoals, r.awayGoals, r.homeCards],
      [away, r.awayGoals, r.homeGoals, r.awayCards],
    ] as const) {
      if (!row) continue;
      row.played++;
      row.goalsFor += gf;
      row.goalsAgainst += ga;
      row.goalDiff = row.goalsFor - row.goalsAgainst;
      row.fairPlay += cards;
      if (gf > ga) {
        row.won++;
        row.points += points.win;
      } else if (gf === ga) {
        row.drawn++;
        row.points += points.draw;
      } else {
        row.lost++;
        row.points += points.loss;
      }
    }
  }
  return rows;
}

interface RankContext {
  rows: Map<string, StandingRow>;
  results: ResultLine[];
  points: PointsSettings;
  tiebreakers: Tiebreaker[];
  resolutions: TieResolution[];
  /** Head-to-head only makes sense inside one group. */
  headToHead: boolean;
}

function lotsOrder(
  ids: string[],
  resolutions: TieResolution[],
): string[] | null {
  const r = resolutions.find((res) =>
    ids.every((id) => res.order.includes(id)),
  );
  return r
    ? [...ids].sort((a, b) => r.order.indexOf(a) - r.order.indexOf(b))
    : null;
}

/** Higher is better. Null when the criterion doesn't apply here. */
function criterionValues(
  c: Tiebreaker,
  ids: string[],
  ctx: RankContext,
): Map<string, number> | null {
  if (c === 'H2H_POINTS' || c === 'H2H_GOAL_DIFF') {
    if (!ctx.headToHead) return null;
    const set = new Set(ids);
    const mini = tally(
      ids,
      ctx.results.filter((r) => set.has(r.home) && set.has(r.away)),
      ctx.points,
    );
    return new Map(
      ids.map((id) => [
        id,
        c === 'H2H_POINTS' ? mini.get(id)!.points : mini.get(id)!.goalDiff,
      ]),
    );
  }
  if (c === 'GOAL_DIFF')
    return new Map(ids.map((id) => [id, ctx.rows.get(id)!.goalDiff]));
  if (c === 'GOALS_FOR')
    return new Map(ids.map((id) => [id, ctx.rows.get(id)!.goalsFor]));
  if (c === 'FAIR_PLAY')
    return new Map(ids.map((id) => [id, -ctx.rows.get(id)!.fairPlay]));
  return null;
}

/** Splits ids into buckets of equal value, best bucket first. */
function partition(ids: string[], values: Map<string, number>): string[][] {
  const distinct = [...new Set(ids.map((id) => values.get(id)!))].sort(
    (a, b) => b - a,
  );
  return distinct.map((v) => ids.filter((id) => values.get(id) === v));
}

/**
 * Orders teams level on points. Returns blocks, best first; a block of more
 * than one team is a tie nothing could break. When a criterion separates only
 * some of the teams, the rest start over from the first tiebreaker among
 * themselves, so head-to-head is recomputed for the smaller set.
 */
function breakTie(ids: string[], ctx: RankContext): string[][] {
  if (ids.length <= 1) return [ids];
  for (const c of ctx.tiebreakers) {
    if (c === 'LOTS') {
      const order = lotsOrder(ids, ctx.resolutions);
      if (order) return order.map((id) => [id]);
      continue;
    }
    const values = criterionValues(c, ids, ctx);
    if (!values) continue;
    const buckets = partition(ids, values);
    if (buckets.length === 1) continue;
    return buckets.flatMap((b) => breakTie(b, ctx));
  }
  // An organizer's ruling settles a tie even with LOTS removed from the list.
  const order = lotsOrder(ids, ctx.resolutions);
  return order ? order.map((id) => [id]) : [ids];
}

function rankBlocks(ids: string[], ctx: RankContext): string[][] {
  const byPoints = partition(
    ids,
    new Map(ids.map((id) => [id, ctx.rows.get(id)!.points])),
  );
  return byPoints.flatMap((bucket) => breakTie(bucket, ctx));
}

export interface StandingsResult {
  rows: StandingRow[];
  /** Ties no tiebreaker (or organizer ruling) could break. */
  ties: string[][];
}

/**
 * Standings for one group. `teamIds` in draw order, which also orders teams
 * inside an unbroken tie.
 */
export function computeStandings(
  teamIds: string[],
  results: ResultLine[],
  points: PointsSettings,
  tiebreakers: Tiebreaker[],
  resolutions: TieResolution[] = [],
): StandingsResult {
  const rows = tally(teamIds, results, points);
  const blocks = rankBlocks(teamIds, {
    rows,
    results,
    points,
    tiebreakers,
    resolutions,
    headToHead: true,
  });
  return finishBlocks(blocks, rows);
}

function finishBlocks(
  blocks: string[][],
  rows: Map<string, StandingRow>,
): StandingsResult {
  const out: StandingRow[] = [];
  const ties: string[][] = [];
  let position = 1;
  for (const block of blocks) {
    if (block.length > 1) ties.push(block);
    for (const id of block) {
      out.push({ ...rows.get(id)!, rank: position, tied: block.length > 1 });
    }
    position += block.length;
  }
  return { rows: out, ties };
}

export interface GroupTable {
  groupId: string;
  name: string;
  /** Final order, best first. */
  ranked: string[];
  results: ResultLine[];
}

/**
 * Ranks teams from different groups against each other. Where groups differ
 * in size, a team's results against the bottom teams of its (bigger) group
 * are dropped first, so everyone is compared over the same number of games.
 * Head-to-head doesn't apply across groups.
 */
export function rankAcrossGroups(
  teamIds: string[],
  groups: GroupTable[],
  points: PointsSettings,
  tiebreakers: Tiebreaker[],
  resolutions: TieResolution[] = [],
): StandingsResult {
  const minSize = Math.min(...groups.map((g) => g.ranked.length));
  const groupOf = new Map<string, GroupTable>();
  for (const g of groups) for (const id of g.ranked) groupOf.set(id, g);
  const rows = new Map<string, StandingRow>();
  const allResults: ResultLine[] = [];
  for (const id of teamIds) {
    const g = groupOf.get(id)!;
    const drop = new Set(g.ranked.filter((t) => t !== id).slice(minSize - 1));
    const results = g.results.filter(
      (r) =>
        (r.home === id && !drop.has(r.away)) ||
        (r.away === id && !drop.has(r.home)),
    );
    rows.set(id, tally([id], results, points).get(id)!);
    allResults.push(...results);
  }
  const blocks = rankBlocks(teamIds, {
    rows,
    results: allResults,
    points,
    tiebreakers,
    resolutions,
    headToHead: false,
  });
  return finishBlocks(blocks, rows);
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

export interface QualifiedTeam {
  teamId: string;
  groupId: string;
  groupName: string;
  /** Position in its group, after withdrawn teams are taken out. */
  groupRank: number;
  /** A1, B2…; just the rank for one combined table. */
  seedLabel: string;
  /** 0 = group winners, 1 = runners-up…; `qualifyPerGroup` = best of rest. */
  tier: number;
}

export interface OpenTie {
  teamIds: string[];
  groupId: string | null;
  reason: string;
}

export interface QualificationInput {
  groups: (GroupTable & { ties: string[][] })[];
  qualifyPerGroup: number;
  bestOfRest: number;
  seeding: Seeding;
  points: PointsSettings;
  tiebreakers: Tiebreaker[];
  resolutions: TieResolution[];
}

export interface QualificationOutput {
  /** In seed order: index 0 is seed 1. */
  qualifiers: QualifiedTeam[];
  /** Ties that block the bracket until the organizer resolves them. */
  ties: OpenTie[];
}

/**
 * Who goes through and in what seed order.
 *
 * Ties block only where they decide something: a group position up to the
 * cut (plus the next place when best-of-rest looks at it), or the
 * best-of-rest cut itself. Teams level across groups for seeding alone fall
 * back to group order.
 */
export function qualify(input: QualificationInput): QualificationOutput {
  const { groups, qualifyPerGroup: q, bestOfRest: b } = input;
  const single = groups.length === 1;
  const ties: OpenTie[] = [];
  const limit = q + (b > 0 ? 1 : 0);
  for (const g of groups) {
    for (const tie of g.ties) {
      const positions = tie
        .map((id) => g.ranked.indexOf(id))
        .filter((i) => i >= 0);
      if (positions.length > 1 && Math.min(...positions) < limit) {
        ties.push({
          teamIds: tie,
          groupId: g.groupId,
          reason: `Level in group ${g.name} after all tiebreakers`,
        });
      }
    }
  }

  const groupIndex = new Map(groups.map((g, i) => [g.groupId, i]));
  const entry = (g: GroupTable, rank: number, tier: number): QualifiedTeam => ({
    teamId: g.ranked[rank],
    groupId: g.groupId,
    groupName: g.name,
    groupRank: rank + 1,
    seedLabel: single ? String(rank + 1) : `${g.name}${rank + 1}`,
    tier,
  });
  const across = (ids: string[]) => {
    const { rows, ties: blocks } = rankAcrossGroups(
      ids,
      groups,
      input.points,
      input.tiebreakers,
      input.resolutions,
    );
    return { order: rows.map((r) => r.teamId), blocks };
  };
  const byGroupOrder = (
    teams: QualifiedTeam[],
    order: string[],
    blocks: string[][],
  ) => {
    // Unbroken cross-group ties fall back to group order (A before B).
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const block of blocks) {
      const start = Math.min(...block.map((id) => pos.get(id)!));
      const sorted = teams
        .filter((t) => block.includes(t.teamId))
        .sort(
          (x, y) => groupIndex.get(x.groupId)! - groupIndex.get(y.groupId)!,
        );
      sorted.forEach((t, i) => pos.set(t.teamId, start + i));
    }
    return [...teams].sort((x, y) => pos.get(x.teamId)! - pos.get(y.teamId)!);
  };

  const tiers: QualifiedTeam[][] = [];
  for (let k = 0; k < q; k++) {
    const teams = groups
      .filter((g) => g.ranked.length > k)
      .map((g) => entry(g, k, k));
    if (single) {
      tiers.push(teams);
      continue;
    }
    const { order, blocks } = across(teams.map((t) => t.teamId));
    tiers.push(byGroupOrder(teams, order, blocks));
  }
  if (b > 0) {
    const rest = groups
      .filter((g) => g.ranked.length > q)
      .map((g) => entry(g, q, q));
    const { order, blocks } = across(rest.map((t) => t.teamId));
    for (const block of blocks) {
      const idx = block.map((id) => order.indexOf(id));
      if (Math.min(...idx) < b && Math.max(...idx) >= b) {
        ties.push({
          teamIds: block,
          groupId: null,
          reason: 'Level for a best-of-rest place after all tiebreakers',
        });
      }
    }
    tiers.push(byGroupOrder(rest, order, blocks).slice(0, b));
  }

  let qualifiers = tiers.flat();
  if (input.seeding === 'RANKED' && !single) {
    const { order, blocks } = across(qualifiers.map((t) => t.teamId));
    qualifiers = byGroupOrder(qualifiers, order, blocks);
  }
  return { qualifiers, ties };
}

// ---------------------------------------------------------------------------
// Bracket
// ---------------------------------------------------------------------------

export interface BracketSeed {
  teamId: string;
  groupId: string | null;
  tier: number;
}

export interface FirstRound {
  /** Team at each bracket position; null is a bye. Pairs are (0,1), (2,3)… */
  slots: (string | null)[];
  /** First-round pairs still matching two teams from one group. */
  clashes: number[];
}

/**
 * Places seeds so that 1 plays the last seed, 2 the second-last, and so on;
 * missing seeds at the bottom become byes for the top seeds. With
 * `avoidSameGroup`, a pair from one group swaps its lower team with another
 * pair's — same tier first, nearest pair first — until neither pair clashes.
 */
export function seedBracket(
  seeds: BracketSeed[],
  avoidSameGroup: boolean,
): FirstRound {
  const size = Math.max(2, nextPowerOfTwo(seeds.length));
  const slotSeeds: (BracketSeed | null)[] = bracketOrder(size).map(
    (s) => seeds[s - 1] ?? null,
  );
  const pairs = size / 2;
  const clash = (p: number) => {
    const a = slotSeeds[2 * p];
    const b = slotSeeds[2 * p + 1];
    return !!a && !!b && a.groupId !== null && a.groupId === b.groupId;
  };
  if (avoidSameGroup) {
    for (let p = 0; p < pairs; p++) {
      if (!clash(p)) continue;
      const lower = slotSeeds[2 * p + 1]!;
      const candidates = Array.from({ length: pairs }, (_, i) => i)
        .filter((i) => i !== p && slotSeeds[2 * i + 1])
        .sort(
          (x, y) =>
            Number(slotSeeds[2 * x + 1]!.tier !== lower.tier) -
              Number(slotSeeds[2 * y + 1]!.tier !== lower.tier) ||
            Math.abs(x - p) - Math.abs(y - p),
        );
      for (const other of candidates) {
        swap(slotSeeds, 2 * p + 1, 2 * other + 1);
        if (!clash(p) && !clash(other)) break;
        swap(slotSeeds, 2 * p + 1, 2 * other + 1);
      }
    }
  }
  const clashes = Array.from({ length: pairs }, (_, i) => i).filter(clash);
  return { slots: slotSeeds.map((s) => s?.teamId ?? null), clashes };
}

function swap<T>(arr: T[], i: number, j: number) {
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

/**
 * A bracket the organizer laid out by hand: one entry per position, null for
 * a bye, every team exactly once, and no match of two byes.
 */
export function validateBracketOrder(
  order: (string | null)[],
  teamIds: string[],
): string | null {
  const size = Math.max(2, nextPowerOfTwo(teamIds.length));
  if (order.length !== size)
    return `order needs ${size} positions (${teamIds.length} teams, ${size - teamIds.length} byes)`;
  const err = validatePartition(
    'order',
    [order.filter((id): id is string => id !== null)],
    teamIds,
  );
  if (err) return err;
  for (let p = 0; p < size / 2; p++) {
    if (order[2 * p] === null && order[2 * p + 1] === null)
      return `positions ${2 * p} and ${2 * p + 1} are both byes`;
  }
  return null;
}
