import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      // Device tokens live on the user, and the socket handshake resolves a
      // Cognito sub to a user id. Registered as a schema rather than importing
      // UsersModule, which would be a wider dependency than this needs.
      { name: User.name, schema: UserSchema },
    ]),
    // For CognitoJwtVerifier, used to authenticate the socket handshake.
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, PushService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
