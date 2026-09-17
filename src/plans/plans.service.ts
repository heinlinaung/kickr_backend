// src/plans/plans.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { PlanLimits, planLimits } from './plans';

/**
 * Resolves which limits apply to an action — the join between `User.plan`
 * (data) and the `PLANS` registry (code, see plans.ts).
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
  ) {}

  /** The limits for one user. Unknown user or plan → the default plan. */
  async limitsFor(userId: string): Promise<PlanLimits> {
    const user = await this.userModel
      .findById(userId)
      .select('plan')
      .lean<{ plan?: string }>();
    return planLimits(user?.plan);
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
    if (!group?.ownerId) return planLimits(undefined);
    return this.limitsFor(group.ownerId.toString());
  }
}
