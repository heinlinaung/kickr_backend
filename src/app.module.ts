import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GroupsModule } from './groups/groups.module';
import { LocationsModule } from './locations/locations.module';
import { InvitationsModule } from './invitations/invitations.module';
import { ChatModule } from './chat/chat.module';
import { EventsModule } from './events/events.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { ShuffleModule } from './shuffle/shuffle.module';
import { AdminModule } from './admin/admin.module';
import { GlobalFootballTeamsModule } from './global-football-teams/global-football-teams.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    AuthModule,
    UsersModule,
    NotificationsModule,
    GroupsModule,
    LocationsModule,
    EventsModule,
    TournamentsModule,
    ShuffleModule,
    InvitationsModule,
    ChatModule,
    AdminModule,
    GlobalFootballTeamsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
