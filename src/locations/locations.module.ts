import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupLocationsController } from './group-locations.controller';
import { LocationsService } from './locations.service';
import { Location, LocationSchema } from './schemas/location.schema';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Location.name, schema: LocationSchema },
      // Registered directly (not via GroupsModule) to avoid a circular import:
      // GroupsModule already imports LocationsModule.
      { name: GroupMember.name, schema: GroupMemberSchema },
      { name: Group.name, schema: GroupSchema },
    ]),
  ],
  controllers: [GroupLocationsController],
  providers: [LocationsService],
  exports: [LocationsService, MongooseModule],
})
export class LocationsModule {}
