import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { Group, GroupSchema } from './schemas/group.schema';
import { GroupMember, GroupMemberSchema } from './schemas/group-member.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
    ]),
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService, MongooseModule],
})
export class GroupsModule {}
