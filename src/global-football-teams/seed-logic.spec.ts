// src/global-football-teams/seed-logic.spec.ts
/**
 * Guards the seed list itself, which lives in
 * `scripts/seed-global-football-teams.ts` and cannot be imported (it connects
 * to Mongo on load). The list is parsed out of the source instead, so a typo
 * or duplicate fails here rather than after writing to a database.
 *
 * Worth pinning because `name` is uniquely indexed AND the match key: a typo
 * inserts a second club on the next run instead of updating the existing row.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = join(
  __dirname,
  '..',
  '..',
  'scripts',
  'seed-global-football-teams.ts',
);

/** The 20 clubs as supplied, in the order given. */
const EXPECTED = [
  'Manchester United',
  'Liverpool',
  'Arsenal',
  'Chelsea',
  'Manchester City',
  'Tottenham Hotspur',
  'Newcastle United',
  'West Ham United',
  'Aston Villa',
  'Everton',
  'Crystal Palace',
  'Brighton & Hove Albion',
  'Fulham',
  'Nottingham Forest',
  'AFC Bournemouth',
  'Brentford',
  'Leeds United',
  'Sunderland',
  'Burnley',
  'Wolverhampton Wanderers',
];

describe('global football teams seed list', () => {
  const src = readFileSync(SOURCE, 'utf8');
  const rows = [
    ...src.matchAll(/\{ name: '([^']+)', sortOrder: (\d+) \}/g),
  ].map((m) => ({ name: m[1], sortOrder: Number(m[2]) }));

  it('contains all 20 clubs, in the supplied order', () => {
    expect(rows.map((r) => r.name)).toEqual(EXPECTED);
  });

  it('has no duplicate names', () => {
    // A duplicate would fail the unique index mid-run, leaving a partial seed.
    const names = rows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('numbers sortOrder 1..20 with no gaps or repeats', () => {
    expect(rows.map((r) => r.sortOrder)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('drops the numeric id from the source data', () => {
    // Requested explicitly: use Mongo's _id, not the source list's 1..20.
    const listBody = src.split('const TEAMS')[1].split('];')[0];
    expect(listBody).not.toMatch(/\bid:/);
  });

  it('trims cleanly — no stray whitespace in a name', () => {
    // A trailing space makes 'Arsenal ' a different club from 'Arsenal' to the
    // unique index, so the next run inserts a near-duplicate.
    for (const row of rows) {
      expect(row.name).toBe(row.name.trim());
    }
  });

  it('defaults to a dry run', () => {
    // The destructive-by-default mistake: this script must write nothing
    // unless --apply is passed, matching every other script in scripts/.
    expect(src).toContain("process.argv.includes('--apply')");
  });

  it('never deletes rows that are absent from the list', () => {
    // A club could already be referenced by a user profile; deleting it would
    // leave a dangling id. Extras are reported instead.
    expect(src).not.toMatch(/deleteMany|deleteOne|drop\(/);
  });

  it('redacts credentials before printing the target URI', () => {
    expect(src).toContain("replace(/\\/\\/[^@]*@/, '//<redacted>@')");
  });
});
