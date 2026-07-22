import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
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

  it('signup: creates Cognito user then local profile keyed by sub', async () => {
    cognito.signUp.mockResolvedValue('sub-abc');
    userModel.create.mockResolvedValue({});
    const res = await service.signup({
      username: 'alice',
      name: 'Alice',
      email: 'a@b.com',
      password: 'Password123!',
    });
    expect(cognito.signUp).toHaveBeenCalledWith(
      'alice',
      'Password123!',
      'a@b.com',
    );
    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cognitoSub: 'sub-abc',
        username: 'alice',
        email: 'a@b.com',
        name: 'Alice',
      }),
    );
    expect(res.message).toMatch(/confirm/i);
  });

  it('login: returns Cognito tokens', async () => {
    cognito.login.mockResolvedValue({
      accessToken: 'at',
      idToken: 'it',
      refreshToken: 'rt',
      expiresIn: 3600,
    });
    userModel.findOne.mockReturnValue({
      lean: () => Promise.resolve({ username: 'alice' }),
    });
    const res = await service.login({
      username: 'alice',
      password: 'p',
    });
    expect(res).toEqual(
      expect.objectContaining({ accessToken: 'at', refreshToken: 'rt' }),
    );
  });
});
