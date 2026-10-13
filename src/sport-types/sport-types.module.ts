// src/sport-types/sport-types.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SportType, SportTypeSchema } from './schemas/sport-type.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import {
  EventTemplate,
  EventTemplateSchema,
} from '../events/schemas/event-template.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SportTypesController } from './sport-types.controller';
import { SportTypesService } from './sport-types.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SportType.name, schema: SportTypeSchema },
      // Registered directly (not via their modules) only so delete/subType
      // removal can refuse a value still in use. Those modules import this
      // one, so depending on their services would be circular — same
      // reasoning as LocationsModule's GroupMember model.
      { name: Group.name, schema: GroupSchema },
      { name: Event.name, schema: EventSchema },
      { name: EventTemplate.name, schema: EventTemplateSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [SportTypesController],
  providers: [SportTypesService],
  // Exported so GroupsModule and EventsModule can validate a sportType against
  // the collection without re-registering the model.
  exports: [SportTypesService],
})
export class SportTypesModule {}
