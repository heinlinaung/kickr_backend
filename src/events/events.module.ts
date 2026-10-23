import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsController } from './events.controller';
import { PublicEventsController } from './public-events.controller';
import { EventTemplatesController } from './event-templates.controller';
import {
  EventPayment,
  EventPaymentSchema,
} from './schemas/event-payment.schema';
import { EventsService } from './events.service';
import { Event, EventSchema } from './schemas/event.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Challenge,
  ChallengeSchema,
} from '../challenges/schemas/challenge.schema';
import { EventPlayer, EventPlayerSchema } from './schemas/event-player.schema';
import { EventMatch, EventMatchSchema } from './schemas/event-match.schema';
import { Team, TeamSchema } from './schemas/team.schema';
import {
  EventTeamChat,
  EventTeamChatSchema,
} from './schemas/event-team-chat.schema';
import { EventLike, EventLikeSchema } from './schemas/event-like.schema';
import {
  EventTemplate,
  EventTemplateSchema,
} from './schemas/event-template.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import { Location, LocationSchema } from '../locations/schemas/location.schema';
import { LocationsModule } from '../locations/locations.module';
import { UploadModule } from '../common/upload/upload.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AwardsModule } from '../awards/awards.module';

import { PhotosModule } from '../photos/photos.module';
import { SportTypesModule } from '../sport-types/sport-types.module';
import { PlansModule } from '../plans/plans.module';
import { FinanceService } from '../finance/finance.service';
import { FinanceController } from '../finance/finance.controller';
import {
  EventExpense,
  EventExpenseSchema,
} from '../finance/schemas/event-expense.schema';
import {
  EventSettlement,
  EventSettlementSchema,
} from '../finance/schemas/event-settlement.schema';
import {
  GroupFund,
  GroupFundSchema,
} from '../finance/schemas/group-fund.schema';
import {
  GroupFundTransaction,
  GroupFundTransactionSchema,
} from '../finance/schemas/group-fund-transaction.schema';
import {
  EventFeeAdjustment,
  EventFeeAdjustmentSchema,
} from '../finance/schemas/event-fee-adjustment.schema';

@Module({
  imports: [
    // For event photos, which land in the shared `photos` collection so they
    // also appear in the owning group's gallery.
    PhotosModule,
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
      // Needed for the group's rules on event detail and the ?region= filter.
      { name: Group.name, schema: GroupSchema },
      // Step 2-4 collections: fixtures, team chats, likes and templates.
      { name: EventMatch.name, schema: EventMatchSchema },
      { name: Team.name, schema: TeamSchema },
      { name: EventTeamChat.name, schema: EventTeamChatSchema },
      { name: EventLike.name, schema: EventLikeSchema },
      { name: EventTemplate.name, schema: EventTemplateSchema },
      { name: EventPayment.name, schema: EventPaymentSchema },
      // Read directly for $geoNear — it must be the first aggregation stage,
      // so the geo query starts from locations rather than from events.
      { name: Location.name, schema: LocationSchema },
      // For resolving formation slots to display names (see EventsService).
      { name: User.name, schema: UserSchema },
      // For challenge events (schema-only — ChallengesModule imports THIS
      // module, so importing it back would close a cycle).
      { name: Challenge.name, schema: ChallengeSchema },
      // Event Funds. Registered here, not in a module of their own:
      // reviewPayment posts late payments through FinanceService, and
      // FinanceService reads events/payments — a separate module would
      // import this one and be imported back.
      { name: EventExpense.name, schema: EventExpenseSchema },
      { name: EventSettlement.name, schema: EventSettlementSchema },
      { name: GroupFund.name, schema: GroupFundSchema },
      { name: GroupFundTransaction.name, schema: GroupFundTransactionSchema },
      { name: EventFeeAdjustment.name, schema: EventFeeAdjustmentSchema },
    ]),
    LocationsModule,
    UploadModule,
    NotificationsModule,
    SportTypesModule,
    PlansModule,
    // MVP awards and the Group Challenge award on `done`. A leaf (schemas
    // only), so importing it closes no cycle.
    AwardsModule,
  ],
  // PublicEventsController LAST: its bare `:id` must register after every
  // static route (search, joined, …) in the guarded controller.
  controllers: [
    EventsController,
    EventTemplatesController,
    FinanceController,
    PublicEventsController,
  ],
  providers: [EventsService, FinanceService],
  exports: [EventsService, FinanceService, MongooseModule],
})
export class EventsModule {}
