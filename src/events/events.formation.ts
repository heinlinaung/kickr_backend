// src/events/events.formation.ts
/**
 * Formation layout rules — the pure half of the team-formation feature.
 *
 * No Mongoose, no Nest: total functions over plain values, like
 * `events.lifecycle.ts`, so the layout arithmetic is unit-testable without a
 * database. The service owns permissions, membership and persistence; this
 * module owns what a well-formed formation IS.
 */

/** Longest label a formation may carry ("My 4-4-2"). */
export const MAX_FORMATION_NAME = 60;

export interface FormationGroups {
  goalkeeper: string;
  defenders: string[];
  midfielders: string[];
  forwards: string[];
}

/**
 * "4-4-2" -> [4, 4, 2]; null when the string is not a formation at all.
 *
 * Every segment must be a positive integer. A single line ("4") is accepted —
 * the global list never goes below two lines, but the server is free-form by
 * design and one line of outfielders plus a goalkeeper is a valid 5-a-side
 * shape.
 */
export function parseFormation(formation: string): number[] | null {
  if (typeof formation !== 'string' || !/^\d+(-\d+)*$/.test(formation)) {
    return null;
  }
  const segments = formation.split('-').map(Number);
  return segments.every((n) => Number.isInteger(n) && n >= 1)
    ? segments
    : null;
}

/** Every placed id, goalkeeper first, group order preserved. */
export function placedIds(groups: FormationGroups): string[] {
  return [
    groups.goalkeeper,
    ...groups.defenders,
    ...groups.midfielders,
    ...groups.forwards,
  ];
}

/**
 * Checks a submitted layout. Returns an error message, or null when valid.
 *
 * The mapping of lines to position groups is the CLIENT's decision: the
 * formation's segments must match the sizes of the non-empty groups in
 * defenders -> midfielders -> forwards order, so "2-2" may arrive as
 * defenders+forwards, defenders+midfielders, or midfielders+forwards. The
 * goalkeeper is always required and always outside the segments.
 *
 * `playerCount` is redundant with the formation on purpose — the client
 * states it, the server checks it, and a mismatch is a bug surfaced rather
 * than silently recomputed.
 */
export function validateFormationLayout(
  formation: string,
  groups: FormationGroups,
  playerCount: number,
): string | null {
  const segments = parseFormation(formation);
  if (!segments) {
    return `formation must be positive numbers joined by dashes, like '4-4-2' (got '${formation}')`;
  }

  const nonEmpty = [
    ['defenders', groups.defenders.length] as const,
    ['midfielders', groups.midfielders.length] as const,
    ['forwards', groups.forwards.length] as const,
  ].filter(([, size]) => size > 0);

  const sizes = nonEmpty.map(([, size]) => size);
  if (
    sizes.length !== segments.length ||
    sizes.some((size, index) => size !== segments[index])
  ) {
    const got =
      nonEmpty.map(([label, size]) => `${label} ${size}`).join(', ') ||
      'no outfield players';
    return `The position groups (${got}) do not match formation '${formation}'`;
  }

  const outfield = segments.reduce((sum, n) => sum + n, 0);
  if (outfield + 1 !== playerCount) {
    return (
      `formation '${formation}' places ${outfield} outfield players + 1 ` +
      `goalkeeper = ${outfield + 1}, but playerCount is ${playerCount}`
    );
  }

  const ids = placedIds(groups);
  if (new Set(ids).size !== ids.length) {
    return 'The same player appears in more than one position';
  }

  return null;
}
