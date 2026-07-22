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
});
