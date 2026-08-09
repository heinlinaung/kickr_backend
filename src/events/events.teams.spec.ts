// src/events/events.teams.spec.ts
import { unassignedPlayerIds, validateTeams } from './events.teams';

const JOINED = ['p1', 'p2', 'p3', 'p4'];

const team = (name: string, playerIds: string[]) => ({ name, playerIds });

describe('validateTeams (spec §4.3.1)', () => {
  it('accepts a well-formed submission', () => {
    expect(
      validateTeams([team('Red', ['p1', 'p2']), team('Blue', ['p3'])], JOINED),
    ).toBeNull();
  });

  it('rejects fewer than two teams — fixtures need a pairing', () => {
    expect(validateTeams([team('Red', ['p1'])], JOINED)).toMatch(
      /At least 2 teams/,
    );
  });

  it('rejects more than six teams — the colour vocabulary caps it', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => team(n, []));
    expect(validateTeams(teams, JOINED)).toMatch(/At most 6 teams/);
  });

  it('rejects a player who never joined, naming the id', () => {
    const problem = validateTeams(
      [team('Red', ['p1']), team('Blue', ['ghost'])],
      JOINED,
    );
    // The message must name the id — "invalid teams" is unactionable on mobile.
    expect(problem).toContain('ghost');
    expect(problem).toMatch(/not a joined player/);
  });

  it('rejects a player listed in two teams, naming both teams', () => {
    const problem = validateTeams(
      [team('Red', ['p1', 'p2']), team('Blue', ['p1'])],
      JOINED,
    );
    expect(problem).toContain('p1');
    expect(problem).toContain('Red');
    expect(problem).toContain('Blue');
  });

  it('rejects a duplicate id within one team', () => {
    const problem = validateTeams(
      [team('Red', ['p1', 'p1']), team('Blue', ['p2'])],
      JOINED,
    );
    expect(problem).toContain('p1');
    expect(problem).toMatch(/listed twice in Red/);
  });

  it('rejects an empty team name', () => {
    expect(
      validateTeams([team('  ', ['p1']), team('Blue', ['p2'])], JOINED),
    ).toMatch(/non-empty name/);
  });

  it('rejects duplicate team names', () => {
    expect(
      validateTeams([team('Red', ['p1']), team('Red', ['p2'])], JOINED),
    ).toMatch(/Duplicate team name/);
  });

  it('treats team names case-insensitively when deduping', () => {
    // 'Red' and 'red' would otherwise key two chats reading as one team.
    expect(
      validateTeams([team('Red', ['p1']), team('red', ['p2'])], JOINED),
    ).toMatch(/Duplicate team name/);
  });

  it('rejects a non-array playerIds', () => {
    const teams = [{ name: 'Red', playerIds: 'p1' }, team('Blue', ['p2'])];
    expect(validateTeams(teams as any, JOINED)).toMatch(/playerIds array/);
  });

  it('rejects a missing teams array', () => {
    expect(validateTeams(undefined, JOINED)).toMatch(/At least 2 teams/);
  });

  it('allows a partial roster — reserves are legal (§4.3.1)', () => {
    // p3 and p4 are joined but unassigned. That is deliberate, not an error.
    expect(
      validateTeams([team('Red', ['p1']), team('Blue', ['p2'])], JOINED),
    ).toBeNull();
  });

  it('allows an empty team', () => {
    expect(
      validateTeams([team('Red', ['p1']), team('Blue', [])], JOINED),
    ).toBeNull();
  });

  it('reports one fault at a time, in the order encountered', () => {
    // 'ghost' is both unjoined and duplicated. Validation stops at the first
    // problem it meets — the unjoined check on team 1, before team 2 is read.
    expect(
      validateTeams([team('Red', ['ghost']), team('Blue', ['ghost'])], JOINED),
    ).toMatch(/not a joined player/);

    // With a joined id, the same shape surfaces the cross-team duplicate.
    expect(
      validateTeams([team('Red', ['p1']), team('Blue', ['p1'])], JOINED),
    ).toMatch(/appears in both/);
  });
});

describe('unassignedPlayerIds', () => {
  it('lists joined players left off every team', () => {
    expect(
      unassignedPlayerIds([team('Red', ['p1']), team('Blue', ['p2'])], JOINED),
    ).toEqual(['p3', 'p4']);
  });

  it('is empty when everyone is assigned', () => {
    expect(
      unassignedPlayerIds(
        [team('Red', ['p1', 'p2']), team('Blue', ['p3', 'p4'])],
        JOINED,
      ),
    ).toEqual([]);
  });
});
