// src/configuration/configuration.module.ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from '../app-config/app-config.module';
import { CountriesModule } from '../countries/countries.module';
import { SportTypesModule } from '../sport-types/sport-types.module';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';

@Module({
  imports: [AppConfigModule, CountriesModule, SportTypesModule],
  controllers: [ConfigurationController],
  providers: [ConfigurationService],
})
export class ConfigurationModule {}
