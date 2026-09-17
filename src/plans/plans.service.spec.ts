// src/plans/plans.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PlansService } from './plans.service';
import { PLANS } from './plans';
import { User } from '../users/schemas/user.schema';
import { Group } from '../groups/schemas/group.schema';

const USER_ID = '507f191e810c19729de860ea';
const GROUP_ID = '6a6b2366f78b66d63a911a9e';

describe('PlansService', () => {
  let service: PlansService;
  const userModel: any = {};
  const groupModel: any = {};

  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    userModel.findById = jest.fn().mockReturnValue(chain({ plan: 'default' }));
    groupModel.findById = jest
      .fn()
      .mockReturnValue(chain({ ownerId: new Types.ObjectId(USER_ID) }));

    const m = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
      ],
    }).compile();
    service = m.get(PlansService);
  });

  it("limitsFor resolves the user's plan", async () => {
    expect(await service.limitsFor(USER_ID)).toBe(PLANS.default);
  });

  it('limitsFor degrades a missing user or plan to the default plan', async () => {
    userModel.findById.mockReturnValue(chain(null));
    expect(await service.limitsFor(USER_ID)).toBe(PLANS.default);

    userModel.findById.mockReturnValue(chain({}));
    expect(await service.limitsFor(USER_ID)).toBe(PLANS.default);
  });

  it("limitsForGroupOwner resolves through the group's OWNER", async () => {
    await service.limitsForGroupOwner(GROUP_ID);

    expect(String(groupModel.findById.mock.calls[0][0])).toBe(GROUP_ID);
    expect(String(userModel.findById.mock.calls[0][0])).toBe(USER_ID);
  });

  it('limitsForGroupOwner falls back to default when the group is missing', async () => {
    // Existence is the caller's check; this only answers "how much".
    groupModel.findById.mockReturnValue(chain(null));

    expect(await service.limitsForGroupOwner(GROUP_ID)).toBe(PLANS.default);
    expect(userModel.findById).not.toHaveBeenCalled();
  });
});
