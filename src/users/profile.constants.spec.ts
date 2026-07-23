import { FOOTBALL_POSITIONS, PROFILE_VISIBILITY, SPORT_TYPES } from './profile.constants';

describe('profile constants', () => {
  it('football positions', () => {
    expect(FOOTBALL_POSITIONS).toEqual(['goalkeeper', 'defender', 'midfielder', 'forward', 'playmaker']);
  });
  it('visibility', () => {
    expect(PROFILE_VISIBILITY).toEqual(['public', 'members', 'private']);
  });
  it('sports include football', () => {
    expect(SPORT_TYPES).toEqual(expect.arrayContaining(['football', 'futsal']));
  });
});
