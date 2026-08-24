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
    changePassword: jest.fn().mockResolvedValue({ message: 'ok' }),
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
      email: 'a@b.com',
      password: 'Password123!',
    });
    expect(authService.signup).toHaveBeenCalled();
  });

  it('confirmSignup delegates to service', async () => {
    await controller.confirmSignup({ email: 'a@b.com', code: '123456' });
    expect(authService.confirmSignup).toHaveBeenCalled();
  });

  it('login delegates to service', async () => {
    await controller.login({ email: 'a@b.com', password: 'p' });
    expect(authService.login).toHaveBeenCalled();
  });

  describe('changePassword', () => {
    it('passes the access token through, separate from the body', async () => {
      await controller.changePassword('access-tok', {
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass456!',
      });
      expect(authService.changePassword).toHaveBeenCalledWith('access-tok', {
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass456!',
      });
    });

    it('is the only route on this controller behind JwtAuthGuard', () => {
      // Every other password route serves a user who cannot log in, so it must
      // stay open; this one must not. A guard accidentally applied at class
      // level would silently break signup and login for everyone.
      const src: string = require('fs').readFileSync(
        __dirname + '/auth.controller.ts',
        'utf8',
      );
      const guardCount = (src.match(/@UseGuards\(JwtAuthGuard\)/g) ?? []).length;
      expect(guardCount).toBe(1);
      // Guard sits on the method, not above @Controller.
      expect(src).not.toMatch(/@UseGuards\(JwtAuthGuard\)\s*@Controller/);
      expect(src.indexOf("@Post('change-password')")).toBeLessThan(
        src.indexOf('changePassword('),
      );
    });

    it('takes no email in its body, so it cannot target another account', () => {
      const dto: string = require('fs').readFileSync(
        __dirname + '/dto/change-password.dto.ts',
        'utf8',
      );
      expect(dto).not.toContain('email');
      expect(dto).not.toContain('IsEmail');
    });
  });
});
