import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AuthService, defaultNameFromEmail } from './auth.service';
import { CognitoService } from './cognito/cognito.service';
import { User } from '../users/schemas/user.schema';

describe('AuthService (Cognito proxy)', () => {
  let service: AuthService;
  const cognito = {
    signUp: jest.fn(),
    confirmSignUp: jest.fn(),
    resendConfirmation: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    forgotPassword: jest.fn(),
    confirmForgotPassword: jest.fn(),
    changePassword: jest.fn(),
  };
  const userModel = {
    create: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: CognitoService, useValue: cognito },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('signup: registers the email in Cognito then creates a profile keyed by sub', async () => {
    cognito.signUp.mockResolvedValue('sub-abc');
    userModel.create.mockResolvedValue({});
    const res = await service.signup({
      email: 'alice@b.com',
      password: 'Password123!',
    });
    expect(cognito.signUp).toHaveBeenCalledWith('alice@b.com', 'Password123!');
    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cognitoSub: 'sub-abc',
        email: 'alice@b.com',
        // seeded from the email's local part — signup collects no name
        name: 'alice',
      }),
    );
    // no username at registration; it is a profile field set later
    const createCalls = userModel.create.mock.calls as Record<
      string,
      unknown
    >[][];
    expect(createCalls[0][0]).not.toHaveProperty('username');
    // users are auto-confirmed by a pre-sign-up Lambda — no emailed code
    expect(res.message).toBe('Signup successful. You can now log in.');
    expect(res.message).not.toMatch(/check your email/i);
  });

  describe('signup name', () => {
    beforeEach(() => {
      cognito.signUp.mockResolvedValue('sub-abc');
      userModel.create.mockResolvedValue({});
    });

    const nameFromCreate = () =>
      (userModel.create.mock.calls[0][0] as { name: string }).name;

    it('uses the supplied name when present', async () => {
      await service.signup({
        email: 'alice@b.com',
        password: 'Password123!',
        name: 'Thar Htet',
      });
      expect(nameFromCreate()).toBe('Thar Htet');
    });

    it('falls back to the email local part when omitted', async () => {
      await service.signup({
        email: 'alice@b.com',
        password: 'Password123!',
      });
      expect(nameFromCreate()).toBe(defaultNameFromEmail('alice@b.com'));
    });

    it('falls back when the name is only whitespace', async () => {
      await service.signup({
        email: 'alice@b.com',
        password: 'Password123!',
        name: '   ',
      });
      // Without the trim this would persist a blank display name.
      expect(nameFromCreate()).toBe('alice');
    });

    it('trims surrounding whitespace off a real name', async () => {
      await service.signup({
        email: 'alice@b.com',
        password: 'Password123!',
        name: '  Thar Htet  ',
      });
      expect(nameFromCreate()).toBe('Thar Htet');
    });
  });

  it('signup: lowercases the email before Cognito and Mongo see it', async () => {
    cognito.signUp.mockResolvedValue('sub-abc');
    userModel.create.mockResolvedValue({});
    await service.signup({ email: 'Alice@B.com', password: 'Password123!' });
    expect(cognito.signUp).toHaveBeenCalledWith('alice@b.com', 'Password123!');
    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@b.com', name: 'alice' }),
    );
  });

  it('login: authenticates by email and returns Cognito tokens', async () => {
    cognito.login.mockResolvedValue({
      accessToken: 'at',
      idToken: 'it',
      refreshToken: 'rt',
      expiresIn: 3600,
    });
    userModel.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({ email: 'alice@b.com', cognitoSub: 'sub-uuid-1' }),
    });
    const res = await service.login({
      email: 'Alice@b.com',
      password: 'p',
    });
    expect(cognito.login).toHaveBeenCalledWith('alice@b.com', 'p');
    expect(userModel.findOne).toHaveBeenCalledWith({ email: 'alice@b.com' });
    expect(res).toEqual(
      expect.objectContaining({ accessToken: 'at', refreshToken: 'rt' }),
    );
    // the client needs this to call POST /auth/refresh
    expect(res.sub).toBe('sub-uuid-1');
  });

  it('confirmSignup: passes the lowercased email to Cognito', async () => {
    await service.confirmSignup({ email: 'A@b.com', code: '123456' });
    expect(cognito.confirmSignUp).toHaveBeenCalledWith('a@b.com', '123456');
  });

  it('resendConfirmation: passes the lowercased email to Cognito', async () => {
    await service.resendConfirmation({ email: 'A@b.com' });
    expect(cognito.resendConfirmation).toHaveBeenCalledWith('a@b.com');
  });

  it('forgotPassword: passes the lowercased email to Cognito', async () => {
    await service.forgotPassword({ email: 'A@b.com' });
    expect(cognito.forgotPassword).toHaveBeenCalledWith('a@b.com');
  });

  it('resetPassword: passes the lowercased email to Cognito', async () => {
    await service.resetPassword({
      email: 'A@b.com',
      code: '123456',
      newPassword: 'NewPassword123!',
    });
    expect(cognito.confirmForgotPassword).toHaveBeenCalledWith(
      'a@b.com',
      '123456',
      'NewPassword123!',
    );
  });

  // REFRESH_TOKEN_AUTH hashes the Cognito sub, not the email — see
  // CognitoService.refresh(). Passing an email here fails against real Cognito.
  it('refreshTokens: passes the sub (not the email) to Cognito', async () => {
    await service.refreshTokens({ sub: 'sub-uuid-1', refreshToken: 'rt' });
    expect(cognito.refresh).toHaveBeenCalledWith('sub-uuid-1', 'rt');
  });
  describe('changePassword', () => {
    it('passes the access token and both passwords to Cognito', async () => {
      cognito.changePassword.mockResolvedValue(undefined);

      await service.changePassword('access-tok', {
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass456!',
      });

      expect(cognito.changePassword).toHaveBeenCalledWith(
        'access-tok',
        'OldPass123!',
        'NewPass456!',
      );
    });

    it('confirms the change without echoing either password', async () => {
      cognito.changePassword.mockResolvedValue(undefined);

      const res = await service.changePassword('access-tok', {
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass456!',
      });

      expect(JSON.stringify(res)).not.toContain('OldPass123!');
      expect(JSON.stringify(res)).not.toContain('NewPass456!');
      expect(res).toHaveProperty('message');
    });

    it('rejects reusing the current password without calling Cognito', async () => {
      // Cognito accepts a no-op change, which reads as success to the user
      // while nothing rotated. Cheaper and clearer to refuse it here.
      await expect(
        service.changePassword('access-tok', {
          currentPassword: 'SamePass123!',
          newPassword: 'SamePass123!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cognito.changePassword).not.toHaveBeenCalled();
    });

    it('lets a Cognito failure propagate unchanged', async () => {
      // mapCognitoError already produced the right status; re-wrapping it here
      // would flatten a 401 into a 500.
      const mapped = new UnauthorizedException('Invalid credentials');
      cognito.changePassword.mockRejectedValue(mapped);

      await expect(
        service.changePassword('access-tok', {
          currentPassword: 'wrong',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toBe(mapped);
    });

});

describe('defaultNameFromEmail', () => {
  it.each([
    ['alice@example.com', 'alice'],
    ['john.doe@example.com', 'john.doe'],
    ['a+tag@example.com', 'a+tag'],
    // '@' inside a quoted local part: split on the LAST '@'
    ['"weird@local"@example.com', '"weird@local"'],
  ])('derives a name from %s', (email, expected) => {
    expect(defaultNameFromEmail(email)).toBe(expected);
  });

  it('falls back to the full address when the local part is too short', () => {
    expect(defaultNameFromEmail('a@example.com')).toBe('a@example.com');
  });
  });
});
