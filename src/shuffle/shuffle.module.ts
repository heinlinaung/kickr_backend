import { Module } from '@nestjs/common';
import { ShuffleController } from './shuffle.controller';
import { ShuffleService } from './shuffle.service';
import { EventsModule } from '../events/events.module';

@Module({
  // Only EventsModule now: the shuffle delegates to EventsService, which owns
  // the models, notifications and permission check it used to duplicate.
  imports: [EventsModule],
  controllers: [ShuffleController],
  providers: [ShuffleService],
})
export class ShuffleModule {}
