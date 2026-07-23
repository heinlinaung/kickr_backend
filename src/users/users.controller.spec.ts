import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController profile routes', () => {
  let controller: UsersController;
  const svc = {
    findById: jest.fn().mockResolvedValue({ _id: 'u1' }),
    updateProfile: jest.fn().mockResolvedValue({}),
    updateAvatar: jest.fn().mockResolvedValue({}),
    getQr: jest.fn().mockResolvedValue({ inviteCode: 'x', inviteLink: 'l' }),
    getPublicProfile: jest.fn().mockResolvedValue({ name: 'Bob' }),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: svc }],
    }).compile();
    controller = m.get(UsersController);
  });
  it('GET me/qr delegates', async () => {
    await controller.getQr({ _id: 'u1' } as any);
    expect(svc.getQr).toHaveBeenCalledWith('u1');
  });
  it('GET :id/profile delegates', async () => {
    await controller.getPublicProfile('u2');
    expect(svc.getPublicProfile).toHaveBeenCalledWith('u2');
  });
});
