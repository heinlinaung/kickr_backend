// src/plans/plans.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PlansService } from './plans.service';
import { DEFAULT_PLAN_LIMITS } from './plans';
import { Plan } from './schemas/plan.schema';
import { User } from '../users/schemas/user.schema';
import { Group } from '../groups/schemas/group.schema';

const USER_ID = '507f191e810c19729de860ea';
const GROUP_ID = '6a6b2366f78b66d63a911a9e';

/** The two rows scripts/seed-plans.ts writes. */
const SEEDED: Record<string, any> = {
  default: {
    name: 'default',
    maxGroupsOwned: 2,
    maxEventsPerWeek: 3,
    maxGalleryPhotosPerGroup: 50,
  },
  'no-limit-plan': {
    name: 'no-limit-plan',
    maxGroupsOwned: null,
    maxEventsPerWeek: null,
    maxGalleryPhotosPerGroup: null,
  },
};

describe('PlansService', () => {
  let service: PlansService;
  const userModel: any = {};
  const groupModel: any = {};
  const planModel: any = {};

  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  /** planModel.findOne answering by name from an in-memory seed. */
  const seedPlans = (rows: Record<string, any> = SEEDED) => {
    planModel.findOne = jest.fn(({ name }: { name: string }) => ({
      lean: jest.fn().mockResolvedValue(rows[name] ?? null),
    }));
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    seedPlans();
    userModel.findById = jest.fn().mockReturnValue(chain({ plan: 'default' }));
    groupModel.findById = jest
      .fn()
      .mockReturnValue(chain({ ownerId: new Types.ObjectId(USER_ID) }));

    const m = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(Plan.name), useValue: planModel },
      ],
    }).compile();
    service = m.get(PlansService);
  });

  describe('limitsByName — the plans collection is the source of truth', () => {
    it('reads the default row from the database', async () => {
      expect(await service.limitsByName('default')).toEqual({
        maxGroupsOwned: 2,
        maxEventsPerWeek: 3,
        maxGalleryPhotosPerGroup: 50,
      });
    });

    it('no-limit-plan resolves every null to Infinity', async () => {
      // count >= Infinity is never true, so every enforcement site opens up
      // without knowing this plan exists.
      expect(await service.limitsByName('no-limit-plan')).toEqual({
        maxGroupsOwned: Number.POSITIVE_INFINITY,
        maxEventsPerWeek: Number.POSITIVE_INFINITY,
        maxGalleryPhotosPerGroup: Number.POSITIVE_INFINITY,
      });
    });

    it('an unknown plan name degrades to the default ROW', async () => {
      seedPlans({
        ...SEEDED,
        default: { ...SEEDED.default, maxGroupsOwned: 4 },
      });

      const limits = await service.limitsByName('premium');

      // The (tuned) database row won, not the in-code fallback.
      expect(limits.maxGroupsOwned).toBe(4);
    });

    it('an UNSEEDED database degrades to the in-code fallback', async () => {
      seedPlans({});

      expect(await service.limitsByName('no-limit-plan')).toBe(
        DEFAULT_PLAN_LIMITS,
      );
    });

    it('a half-seeded row falls back per FIELD, tight not open', async () => {
      seedPlans({ default: { name: 'default', maxGroupsOwned: 5 } });

      const limits = await service.limitsByName('default');

      expect(limits.maxGroupsOwned).toBe(5);
      // Missing ≠ null: absent fields read as the default limits.
      expect(limits.maxEventsPerWeek).toBe(
        DEFAULT_PLAN_LIMITS.maxEventsPerWeek,
      );
      expect(limits.maxGalleryPhotosPerGroup).toBe(
        DEFAULT_PLAN_LIMITS.maxGalleryPhotosPerGroup,
      );
    });
  });

  describe('limitsFor', () => {
    it("resolves through the user's plan name", async () => {
      userModel.findById.mockReturnValue(chain({ plan: 'no-limit-plan' }));

      const limits = await service.limitsFor(USER_ID);

      expect(limits.maxGroupsOwned).toBe(Number.POSITIVE_INFINITY);
    });

    it('degrades a missing user or plan field to the default plan', async () => {
      userModel.findById.mockReturnValue(chain(null));
      expect((await service.limitsFor(USER_ID)).maxGroupsOwned).toBe(2);

      userModel.findById.mockReturnValue(chain({}));
      expect((await service.limitsFor(USER_ID)).maxGroupsOwned).toBe(2);
    });
  });

  describe('limitsForGroupOwner', () => {
    it("resolves through the group's OWNER", async () => {
      await service.limitsForGroupOwner(GROUP_ID);

      expect(String(groupModel.findById.mock.calls[0][0])).toBe(GROUP_ID);
      expect(String(userModel.findById.mock.calls[0][0])).toBe(USER_ID);
    });

    it('an owner on no-limit-plan lifts the group gallery cap', async () => {
      userModel.findById.mockReturnValue(chain({ plan: 'no-limit-plan' }));

      const limits = await service.limitsForGroupOwner(GROUP_ID);

      expect(limits.maxGalleryPhotosPerGroup).toBe(Number.POSITIVE_INFINITY);
    });

    it('falls back to the default plan when the group is missing', async () => {
      // Existence is the caller's check; this only answers "how much".
      groupModel.findById.mockReturnValue(chain(null));

      expect(
        (await service.limitsForGroupOwner(GROUP_ID)).maxGroupsOwned,
      ).toBe(2);
      expect(userModel.findById).not.toHaveBeenCalled();
    });
  });
});
