// src/plans/plans.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import { Plan, PlanSchema } from './schemas/plan.schema';
import { PlansService } from './plans.service';

/**
 * Deliberately a leaf: only schemas, no module imports, no controller — plan
 * limits are read-only reference data, changed by re-running
 * `scripts/seed-plans.ts`. Exported so Groups/Events/Photos can meter
 * creation against a plan without closing a module cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Group.name, schema: GroupSchema },
      { name: Plan.name, schema: PlanSchema },
    ]),
  ],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
