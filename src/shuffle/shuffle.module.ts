import { Module } from '@nestjs/common';
import { ShuffleController } from './shuffle.controller';
import { ShuffleService } from './shuffle.service';
import { EventsModule } from '../events/events.module';
import { GroupsModule } from '../groups/groups.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EventsModule, GroupsModule, NotificationsModule],
  controllers: [ShuffleController],
  providers: [ShuffleService],
})
export class ShuffleModule {}
