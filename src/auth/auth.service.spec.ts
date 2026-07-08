import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from '../users/schemas/user.schema';

describe('AuthService', () => {
  let service: AuthService;
  let userModel: any;
  let jwtService: JwtService;

  const mockUser = {
    _id: 'user-id-123',
    email: 'test@example.com',
    passwordHash: '',
    refreshTokenVersion: 0,
    save: jest.fn(),
    toJSON: jest
      .fn()
      .mockReturnValue({ _id: 'user-id-123', email: 'test@example.com' }),
  };

  beforeEach(async () => {
    mockUser.passwordHash = await bcrypt.hash('correct-password', 10);

    userModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
    };

    const config: Record<string, string> = {
      JWT_SECRET: 'access-secret',
      JWT_EXPIRES_IN: '60m',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_REFRESH_EXPIRES_IN: '30d',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('fake-token'),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('login', () => {
    it('returns an access token and a refresh token signed with separate secrets', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      const result = await service.login({
        email: 'test@example.com',
        password: 'correct-password',
      });

      expect(result.token).toBe('fake-token');
      expect(result.refreshToken).toBe('fake-token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-id-123' },
        { expiresIn: '60m' },
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-id-123', ver: 0 },
        { secret: 'refresh-secret', expiresIn: '30d' },
      );
    });

    it('throws UnauthorizedException for wrong password', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshTokens', () => {
    const validPayload = { sub: 'user-id-123', ver: 0 };

    it('rotates a valid refresh token and bumps the stored version', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(validPayload);
      const userForRefresh = {
        ...mockUser,
        refreshTokenVersion: 0,
        save: jest.fn(),
      };
      userModel.findById.mockResolvedValue(userForRefresh);

      const result = await service.refreshTokens({
        refreshToken: 'old-refresh-token',
      });

      expect(jwtService.verify).toHaveBeenCalledWith('old-refresh-token', {
        secret: 'refresh-secret',
      });
      expect(userForRefresh.refreshTokenVersion).toBe(1);
      expect(userForRefresh.save).toHaveBeenCalled();
      expect(result.token).toBe('fake-token');
      expect(result.refreshToken).toBe('fake-token');
    });

    it('rejects a replayed refresh token whose version no longer matches', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(validPayload);
      const userForRefresh = {
        ...mockUser,
        refreshTokenVersion: 1,
        save: jest.fn(),
      };
      userModel.findById.mockResolvedValue(userForRefresh);

      await expect(
        service.refreshTokens({ refreshToken: 'replayed-refresh-token' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(userForRefresh.save).not.toHaveBeenCalled();
    });

    it('rejects an expired or invalid refresh token', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.refreshTokens({ refreshToken: 'expired-refresh-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a refresh token for a user that no longer exists', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(validPayload);
      userModel.findById.mockResolvedValue(null);

      await expect(
        service.refreshTokens({ refreshToken: 'orphaned-refresh-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
