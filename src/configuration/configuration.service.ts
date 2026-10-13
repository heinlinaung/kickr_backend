// src/configuration/configuration.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { AppConfigService } from '../app-config/app-config.service';
import { CountriesService } from '../countries/countries.service';
import { SportTypesService } from '../sport-types/sport-types.service';

@Injectable()
export class ConfigurationService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly countries: CountriesService,
    private readonly sportTypes: SportTypesService,
  ) {}

  /**
   * Everything the apps load at startup in one round trip: the live app
   * config, regions keyed by country id, and the sport types list.
   *
   * `config` is null until a superadmin saves the first revision, so the rest
   * of the payload stays usable on a fresh deploy instead of the whole call
   * failing with 404.
   */
  async find() {
    const [config, { regions }, sportTypes] = await Promise.all([
      this.appConfig.findLatest().catch((err) => {
        if (err instanceof NotFoundException) return null;
        throw err;
      }),
      this.countries.findRegionsMap(),
      this.sportTypes.findAll(),
    ]);
    return { config, regions, sportTypes };
  }
}
