import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
// Rate limiting is off — see the note in `imports` below.
// import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
// import { APP_GUARD } from '@nestjs/core';
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
    // RATE LIMITING IS OFF (2026-09-05, deliberate).
    //
    // Was: ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]) — 10 requests
    // per minute, globally, enforced by ThrottlerGuard as an APP_GUARD.
    //
    // Turned off because 10/min is below what a normal client session needs: a
    // cold start that reads /users/me, /global-football-teams and
    // /notifications has already spent three, and paging notifications spends
    // one per page.
    //
    // Two things to fix BEFORE re-enabling, or it will behave worse than
    // having none:
    //   1. `app.set('trust proxy', 1)` in main.ts. Keying is per-IP, so
    //      behind nginx/Caddy every request appears to come from the proxy and
    //      ALL users share one bucket — global limiting disguised as per-IP.
    //   2. Scope it. One global bucket over every route is the wrong shape;
    //      tight limits belong on auth/signup, not on reading a notification
    //      list.
    // Also note the in-memory store is per-process: two containers means two
    // independent counters, so the effective limit doubles.
    //
    // ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
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
    // Removed with ThrottlerModule above. It CANNOT be left registered on its
    // own: ThrottlerGuard injects the module's options and storage, so keeping
    // it here without the module fails dependency resolution at boot.
    //
    // {
    //   provide: APP_GUARD,
    //   useClass: ThrottlerGuard,
    // },
  ],
})
export class AppModule {}
