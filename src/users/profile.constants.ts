export const FOOTBALL_POSITIONS = [
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
  'playmaker',
] as const;
export const PROFILE_VISIBILITY = ['public', 'members', 'private'] as const;
// SPORT_TYPES was removed on 2026-09-22: profile `sports`/`preferredSport`
// now validate against the `sporttypes` collection in UsersService, the same
// source group and event sportType use — the hardcoded copy here had already
// drifted (it never learned about badminton).
