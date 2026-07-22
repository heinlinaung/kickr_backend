import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    signup: jest.fn().mockResolvedValue({ message: 'ok' }),
    confirmSignup: jest.fn().mockResolvedValue({ message: 'ok' }),
    resendConfirmation: jest.fn().mockResolvedValue({ message: 'ok' }),
    login: jest.fn().mockResolvedValue({ accessToken: 'at' }),
    forgotPassword: jest.fn().mockResolvedValue({ message: 'ok' }),
    resetPassword: jest.fn().mockResolvedValue({ message: 'ok' }),
    refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'at' }),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = m.get(AuthController);
  });

  it('signup delegates to service', async () => {
    await controller.signup({
      username: 'a',
      name: 'A',
      email: 'a@b.com',
      password: 'Password123!',
    });
    expect(authService.signup).toHaveBeenCalled();
  });

  it('confirmSignup delegates to service', async () => {
    await controller.confirmSignup({ username: 'a', code: '123456' });
    expect(authService.confirmSignup).toHaveBeenCalled();
  });

  it('login delegates to service', async () => {
    await controller.login({ username: 'a', password: 'p' });
    expect(authService.login).toHaveBeenCalled();
  });
});
