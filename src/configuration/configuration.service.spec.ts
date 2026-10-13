// src/configuration/configuration.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../app-config/app-config.service';
import { CountriesService } from '../countries/countries.service';
import { SportTypesService } from '../sport-types/sport-types.service';
import { ConfigurationService } from './configuration.service';

describe('ConfigurationService', () => {
  const config = { revision: 2, appUpdate: {}, majorUpdate: {} };
  const regions = { myanmar: [{ id: 'yangon', name: 'Yangon' }] };
  const sportTypes = [{ value: 'football', subTypes: ['futsal'] }];

  const appConfig = { findLatest: jest.fn() };
  const countries = { findRegionsMap: jest.fn() };
  const sports = { findAll: jest.fn() };
  let service: ConfigurationService;

  beforeEach(async () => {
    jest.resetAllMocks();
    countries.findRegionsMap.mockResolvedValue({ regions });
    sports.findAll.mockResolvedValue(sportTypes);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfigurationService,
        { provide: AppConfigService, useValue: appConfig },
        { provide: CountriesService, useValue: countries },
        { provide: SportTypesService, useValue: sports },
      ],
    }).compile();
    service = moduleRef.get(ConfigurationService);
  });

  it('combines config, regions and sport types', async () => {
    appConfig.findLatest.mockResolvedValue(config);
    await expect(service.find()).resolves.toEqual({
      config,
      regions,
      sportTypes,
    });
  });

  it('returns config: null before any config is saved', async () => {
    appConfig.findLatest.mockRejectedValue(new NotFoundException());
    await expect(service.find()).resolves.toEqual({
      config: null,
      regions,
      sportTypes,
    });
  });

  it('rethrows other config errors', async () => {
    appConfig.findLatest.mockRejectedValue(new Error('db down'));
    await expect(service.find()).rejects.toThrow('db down');
  });
});
