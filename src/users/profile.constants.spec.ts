import {
  FOOTBALL_POSITIONS,
  PROFILE_VISIBILITY,
} from './profile.constants';

describe('profile constants', () => {
  it('football positions', () => {
    expect(FOOTBALL_POSITIONS).toEqual([
      'goalkeeper',
      'defender',
      'midfielder',
      'forward',
      'playmaker',
    ]);
  });
  it('visibility', () => {
    expect(PROFILE_VISIBILITY).toEqual(['public', 'members', 'private']);
  });
  // SPORT_TYPES is gone: profile sports validate against the `sporttypes`
  // collection now (UsersService.updateProfile), not a hardcoded list.
});
