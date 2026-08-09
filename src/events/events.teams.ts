// src/events/events.teams.ts
/**
 * Validation for a client-submitted team roster (spec §4.3.1).
 *
 * A submitted roster is untrusted input: the client decides who plays where,
 * so the server checks the cases that would corrupt standings or per-player
 * stats before persisting anything.
 *
 * Pure module — takes the submission plus the set of joined player ids and
 * returns either the offending message or null. Errors name the specific ids,
 * because "invalid teams" is unactionable from a mobile client.
 */

import { MAX_TEAMS, MIN_TEAMS } from './events.fixtures';

export interface SubmittedTeam {
  name: string;
  playerIds: string[];
}

/**
 * Validates `teams` against the joined roster.
 *
 * Returns `null` when the submission is legal, or a human-readable message
 * naming the offending id/name. The caller turns that into a 400.
 *
 * Partial assignment is deliberately legal: joined players left out keep
 * `team: null`, which supports reserves and late arrivals. The caller surfaces
 * them as `unassignedPlayerIds` so the app can warn rather than fail silently.
 */
export function validateTeams(
  teams: SubmittedTeam[] | undefined,
  joinedPlayerIds: readonly string[],
): string | null {
  if (!Array.isArray(teams) || teams.length < MIN_TEAMS) {
    return `At least ${MIN_TEAMS} teams are required to generate fixtures`;
  }
  if (teams.length > MAX_TEAMS) {
    return `At most ${MAX_TEAMS} teams are allowed (received ${teams.length})`;
  }

  const joined = new Set(joinedPlayerIds.map(String));
  const seenNames = new Set<string>();
  // Maps a player id to the team that already claimed it, so a cross-team
  // duplicate can name BOTH teams in the error.
  const claimedBy = new Map<string, string>();

  for (const team of teams) {
    const name = typeof team?.name === 'string' ? team.name.trim() : '';
    if (!name) return 'Every team needs a non-empty name';

    // Case-insensitive: "Red" and "red" would key two chats and two sets of
    // fixtures that read as the same team.
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) return `Duplicate team name '${name}'`;
    seenNames.add(nameKey);

    if (!Array.isArray(team.playerIds)) {
      return `Team '${name}' must supply a playerIds array`;
    }

    const withinTeam = new Set<string>();
    for (const rawId of team.playerIds) {
      const playerId = String(rawId);

      if (withinTeam.has(playerId)) {
        return `Player ${playerId} is listed twice in ${name}`;
      }
      withinTeam.add(playerId);

      const other = claimedBy.get(playerId);
      if (other) {
        return `Player ${playerId} appears in both ${other} and ${name}`;
      }
      claimedBy.set(playerId, name);

      if (!joined.has(playerId)) {
        return `Player ${playerId} is not a joined player on this event`;
      }
    }
  }

  return null;
}

/** Joined players absent from the submission — reported, never rejected. */
export function unassignedPlayerIds(
  teams: readonly SubmittedTeam[],
  joinedPlayerIds: readonly string[],
): string[] {
  const assigned = new Set(
    teams.flatMap((team) => (team.playerIds ?? []).map(String)),
  );
  return joinedPlayerIds.map(String).filter((id) => !assigned.has(id));
}
