import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import { EventPlayer, EventPlayerSchema } from '../events/schemas/event-player.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { UploadModule } from '../common/upload/upload.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: Event.name, schema: EventSchema },
    ]),
    UploadModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
