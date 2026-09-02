import { UserSchema, USER_SENSITIVE_PROJECTION } from './user.schema';

describe('User schema (Cognito migration)', () => {
  it('has a cognitoSub path and no passwordHash path', () => {
    const paths = Object.keys(UserSchema.paths);
    expect(paths).toContain('cognitoSub');
    expect(paths).not.toContain('passwordHash');
    expect(paths).not.toContain('refreshTokenVersion');
  });

  it('sensitive projection no longer references removed fields', () => {
    expect(USER_SENSITIVE_PROJECTION).not.toContain('passwordResetToken');
    expect(USER_SENSITIVE_PROJECTION).not.toContain('emailVerificationToken');
  });

  it('excludes devices from the sensitive projection', () => {
    // An FCM token is a push credential: anyone holding one can send
    // notifications to that device. This projection is what keeps them out of
    // GET /users/me and off `request.user`, which the JWT strategy populates on
    // every authenticated request. Dropping `-devices` would leak them silently
    // — nothing else in the read path filters them.
    expect(USER_SENSITIVE_PROJECTION).toContain('-devices');
  });
});

describe('User schema (profile fields)', () => {
  it('has the new profile paths', () => {
    const paths = Object.keys(UserSchema.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        'biography',
        'country',
        'city',
        'dateOfBirth',
        'sports',
        'preferredSport',
        'footballPosition',
        'privacy.profileVisibility',
        'privacy.showStats',
        'privacy.showMatchHistory',
        'inviteCode',
        'highlightVideos',
        'gallery',
      ]),
    );
  });
  it('privacy visibility defaults to public', () => {
    const vis: any = UserSchema.path('privacy.profileVisibility');
    expect(vis.options.default).toBe('public');
  });
});
