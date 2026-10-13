// src/configuration/configuration.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigurationService } from './configuration.service';

/**
 * Public (no token) so the apps can load it before sign-in. Replaces the
 * separate GET /app-config, GET /regions and GET /sport-types reads.
 */
@ApiTags('Configuration')
@Controller('configuration')
export class ConfigurationController {
  constructor(private readonly service: ConfigurationService) {}

  @Get()
  @ApiResponse({
    status: 200,
    description:
      '`{ config: { revision, appUpdate, majorUpdate, createdAt } | null, ' +
      'regions: { myanmar: [{ id, name }], ... }, ' +
      'sportTypes: [{ value, subTypes, sortOrder, matchProvided }] }`',
  })
  @ApiOperation({
    summary: 'App startup configuration (public)',
    description:
      'The latest app config (`null` until one is saved), regions grouped ' +
      'by country id with countries in display order, and the sport types ' +
      'in display order.',
  })
  find() {
    return this.service.find();
  }
}
