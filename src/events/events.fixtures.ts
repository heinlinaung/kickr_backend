// src/events/events.fixtures.ts
/**
 * Fixture generation and standings — the pure half of spec §4.3.
 *
 * No Mongoose, no Nest, no I/O: total functions over plain values, so the
 * round-robin and the points maths can be unit-tested exhaustively without a
 * database. The service layer owns persistence; this module owns the rules.
 */

/** The colour vocabulary a shuffle draws from, in dealing order (spec §4.3.3). */
export const TEAM_COLOURS = [
  'Red',
  'Yellow',
  'Blue',
  'Black',
  'Green',
  'Orange',
] as const;

/** Fixture-generation bounds. Two teams to have a fixture at all; six colours. */
export const MIN_TEAMS = 2;
export const MAX_TEAMS = TEAM_COLOURS.length;

/**
 * Minutes held back from the event before scheduling matches.
 *
 * Warm-up, changeovers and overrun all come out of the booked slot, so the
 * fixture list is built against `duration - BUFFER` rather than the full
 * duration. Without it a schedule that fits exactly on paper runs past the
 * end of the booking in practice.
 */
export const MATCH_BUFFER_MINUTES = 10;

/**
 * How many matches fit in an event.
 *
 * `floor((eventDuration - buffer) / teamDuration)` — floored, so the schedule
 * never exceeds the time booked. Worked examples from the spec:
 *
 *   duration 90,  team 30 -> (90-10)/30  = 2.66 -> 2 matches
 *   duration 100, team 30 -> (100-10)/30 = 3    -> 3 matches
 *
 * Returns 0 when the event is too short to hold even one match; the caller
 * decides whether that is an error.
 */
export function matchCountFor(
  eventDuration: number,
  teamDuration: number,
): number {
  if (!(eventDuration > 0) || !(teamDuration > 0)) return 0;
  const playable = eventDuration - MATCH_BUFFER_MINUTES;
  if (playable <= 0) return 0;
  return Math.floor(playable / teamDuration);
}

export interface Fixture {
  matchNumber: number;
  teamA: string;
  teamB: string;
  scoreA: number | null;
  scoreB: number | null;
  playedAt: Date | null;
}

/**
 * Double round-robin over `teamNames` (spec §4.3.4).
 *
 * Every unordered pair meets twice: leg 1 emits (i, j), leg 2 emits (j, i) with
 * home/away swapped so the repeat is not a literal duplicate row. `matchNumber`
 * runs 1..N sequentially across leg 1 then leg 2.
 *
 * N teams yield N*(N-1) fixtures — 4 teams -> 12, each team playing 6.
 *
 * Scores start `null`, never 0: a goalless draw is a real result, and standings
 * skip unplayed fixtures by testing for null (see `computeStandings`).
 */
/**
 * The double round-robin, truncated to `limit` matches.
 *
 * The time available decides how many matches are played (`matchCountFor`), so
 * a full round-robin is generated and then cut to fit. Taking a prefix of the
 * round-robin rather than choosing pairings freely keeps the schedule fair as
 * far as it goes: leg 1 is emitted in full before leg 2 begins, so with a
 * partial schedule every team still meets a different opponent each time
 * before anyone plays a rematch.
 */
export function generateFixturesLimited(
  teamNames: string[],
  limit: number,
): Fixture[] {
  if (limit <= 0) return [];
  return generateFixtures(teamNames).slice(0, limit);
}

/**
 * The round-robin, repeated as many times as the booked slot has room for.
 *
 * A round-robin is a fixed length — 3 teams meet 6 times — but an event is a
 * block of time, and the two rarely coincide. A two-hour event of ten-minute
 * matches has room for 11, so returning only the 6 leaves an hour of the pitch
 * unscheduled. Extra slots repeat the round-robin from the start rather than
 * inventing pairings, so the rotation stays balanced.
 *
 * `minCount` is a floor, not a cap: a schedule shorter than one full
 * round-robin would drop pairings entirely, which is the truncation this
 * replaced. A short event therefore overruns rather than losing fixtures — the
 * organizer can shorten the match duration or drop matches at the end.
 */
export function generateFixturesFilling(
  teamNames: string[],
  minCount: number,
): Fixture[] {
  const base = generateFixtures(teamNames);
  if (!base.length) return [];

  const target = Math.max(base.length, Math.floor(minCount) || 0);
  return Array.from({ length: target }, (_, index) => ({
    ...base[index % base.length],
    // Renumbered across the whole schedule so slot 7 is match 7, not match 1
    // again — matchNumber addresses a slot and must stay unique.
    matchNumber: index + 1,
  }));
}

export function generateFixtures(teamNames: string[]): Fixture[] {
  const fixtures: Fixture[] = [];
  let matchNumber = 1;

  // Leg 1 then leg 2 as separate passes, rather than emitting both legs per
  // pair. This keeps every team's first meeting in the first half of the
  // schedule instead of playing the same opponent twice in a row.
  for (const [homeIndex, awayIndex] of [
    [0, 1],
    [1, 0],
  ] as const) {
    for (let i = 0; i < teamNames.length; i++) {
      for (let j = i + 1; j < teamNames.length; j++) {
        const pair = [teamNames[i], teamNames[j]];
        fixtures.push({
          matchNumber: matchNumber++,
          teamA: pair[homeIndex],
          teamB: pair[awayIndex],
          scoreA: null,
          scoreB: null,
          playedAt: null,
        });
      }
    }
  }

  return fixtures;
}

/**
 * Deal `playerIds` across the first `teamCount` colours (spec §4.3.3).
 *
 * Round-robin rather than contiguous chunks, so sizes differ by at most one
 * however the count divides. Callers shuffle first — this function is
 * deterministic on purpose so it stays testable.
 */
export function dealIntoTeams(
  playerIds: string[],
  teamCount: number,
): { name: string; playerIds: string[] }[] {
  const count = Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, teamCount));
  const teams = TEAM_COLOURS.slice(0, count).map((name) => ({
    name,
    playerIds: [] as string[],
  }));

  playerIds.forEach((playerId, index) => {
    teams[index % count].playerIds.push(playerId);
  });

  return teams;
}

/** Fisher-Yates, returning a new array rather than mutating the caller's. */
export function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface StandingRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

interface ScoredMatch {
  teamA: string;
  teamB: string;
  scoreA?: number | null;
  scoreB?: number | null;
}

/**
 * Standings folded over `matches` — derived on every read, never stored
 * (spec decision #5), so they cannot drift from the fixtures they summarise.
 *
 * Win 3 / draw 1 / loss 0. A fixture with a null score on either side is
 * skipped as unplayed. Ordering: points, then goal difference, then goals for,
 * then team name — the name tie-break makes the output fully deterministic
 * rather than dependent on insertion order.
 *
 * `teamNames` seeds the table so a team that has not played yet still appears
 * with a zero row; without it, an unplayed team would silently vanish.
 */
export function computeStandings(
  matches: readonly ScoredMatch[],
  teamNames?: readonly string[],
): StandingRow[] {
  const table = new Map<string, StandingRow>();

  const row = (team: string): StandingRow => {
    let existing = table.get(team);
    if (!existing) {
      existing = {
        team,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      };
      table.set(team, existing);
    }
    return existing;
  };

  for (const team of teamNames ?? []) row(team);

  for (const match of matches) {
    // Null OR undefined means unplayed. Deliberately not falsy-checked: 0 is a
    // real scoreline and must count.
    if (match.scoreA === null || match.scoreA === undefined) continue;
    if (match.scoreB === null || match.scoreB === undefined) continue;

    const a = row(match.teamA);
    const b = row(match.teamB);

    a.played++;
    b.played++;
    a.goalsFor += match.scoreA;
    a.goalsAgainst += match.scoreB;
    b.goalsFor += match.scoreB;
    b.goalsAgainst += match.scoreA;

    if (match.scoreA > match.scoreB) {
      a.won++;
      b.lost++;
      a.points += 3;
    } else if (match.scoreA < match.scoreB) {
      b.won++;
      a.lost++;
      b.points += 3;
    } else {
      a.drawn++;
      b.drawn++;
      a.points += 1;
      b.points += 1;
    }
  }

  for (const entry of table.values()) {
    entry.goalDifference = entry.goalsFor - entry.goalsAgainst;
  }

  return [...table.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.goalDifference - x.goalDifference ||
      y.goalsFor - x.goalsFor ||
      x.team.localeCompare(y.team),
  );
}
