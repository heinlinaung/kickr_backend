// src/plans/plans.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { Plan, PlanDocument } from './schemas/plan.schema';
import {
  DEFAULT_PLAN,
  DEFAULT_PLAN_LIMITS,
  PlanLimits,
  resolveLimit,
} from './plans';

/**
 * Resolves which limits apply to an action — the join between `User.plan`
 * (which plan a user is on) and the `plans` collection (what that plan
 * means, seeded by `scripts/seed-plans.ts`).
 *
 * Registers the User and Group schemas directly rather than importing
 * UsersModule/GroupsModule, which would close a cycle: Groups/Events/Photos
 * all need this service, and Groups imports Events which imports Photos. A
 * schema carries no dependencies, so PlansModule stays a leaf every other
 * module can import — the same reasoning as PhotosService.memberRole.
 */
@Injectable()
export class PlansService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(Plan.name) private planModel: Model<PlanDocument>,
  ) {}

  /**
   * The limits of one plan by name.
   *
   * Every miss degrades TIGHT: an unknown name falls back to the `default`
   * row, and a database with no rows at all falls back to the in-code
   * `DEFAULT_PLAN_LIMITS` — enforcement never silently switches off because
   * a seed was forgotten or a user's plan string went stale. A row's `null`
   * limit is the one deliberate opposite: it means unlimited (the
   * `no-limit-plan` convention) and resolves to Infinity.
   */
  async limitsByName(name?: unknown): Promise<PlanLimits> {
    const wanted = typeof name === 'string' && name ? name : DEFAULT_PLAN;
    let row = await this.planModel.findOne({ name: wanted }).lean();
    if (!row && wanted !== DEFAULT_PLAN) {
      row = await this.planModel.findOne({ name: DEFAULT_PLAN }).lean();
    }
    if (!row) return DEFAULT_PLAN_LIMITS;

    return {
      maxGroupsOwned: resolveLimit(
        row.maxGroupsOwned,
        DEFAULT_PLAN_LIMITS.maxGroupsOwned,
      ),
      maxEventsPerWeek: resolveLimit(
        row.maxEventsPerWeek,
        DEFAULT_PLAN_LIMITS.maxEventsPerWeek,
      ),
      maxGalleryPhotosPerGroup: resolveLimit(
        row.maxGalleryPhotosPerGroup,
        DEFAULT_PLAN_LIMITS.maxGalleryPhotosPerGroup,
      ),
    };
  }

  /** The limits for one user. Unknown user or plan → the default plan. */
  async limitsFor(userId: string): Promise<PlanLimits> {
    const user = await this.userModel
      .findById(userId)
      .select('plan')
      .lean<{ plan?: string }>();
    return this.limitsByName(user?.plan);
  }

  /**
   * The limits governing a GROUP-scoped resource, e.g. its photo gallery.
   *
   * A group's capacity is its OWNER's plan: the owner is who would upgrade,
   * and metering on the uploader would let a big roster multiply the cap.
   * A missing group falls back to default limits rather than throwing —
   * existence is the caller's check, this only answers "how much".
   */
  async limitsForGroupOwner(groupId: string): Promise<PlanLimits> {
    const group = await this.groupModel
      .findById(groupId)
      .select('ownerId')
      .lean<{ ownerId?: Types.ObjectId }>();
    if (!group?.ownerId) return this.limitsByName(undefined);
    return this.limitsFor(group.ownerId.toString());
  }
}
