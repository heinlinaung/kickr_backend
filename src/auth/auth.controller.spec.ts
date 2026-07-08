import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            signup: jest.fn(),
            confirmEmail: jest.fn(),
            login: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            refreshTokens: jest.fn().mockResolvedValue({
              token: 'new-access-token',
              refreshToken: 'new-refresh-token',
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  describe('refresh', () => {
    it('delegates to authService.refreshTokens and returns its result', async () => {
      const dto = { refreshToken: 'some-refresh-token' };

      const result = await controller.refresh(dto);

      expect(authService.refreshTokens).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });
  });
});
