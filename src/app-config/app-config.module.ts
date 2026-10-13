import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfig, AppConfigSchema } from './schemas/app-config.schema';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppConfig.name, schema: AppConfigSchema },
    ]),
  ],
  controllers: [AppConfigController],
  providers: [AppConfigService],
  // Exported for GET /configuration.
  exports: [AppConfigService],
})
export class AppConfigModule {}
