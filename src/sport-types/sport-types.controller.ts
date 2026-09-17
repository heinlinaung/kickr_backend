// src/sport-types/sport-types.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SportTypesService } from './sport-types.service';

@ApiTags('Sport types')
@ApiBearerAuth()
@Controller('sport-types')
@UseGuards(JwtAuthGuard)
export class SportTypesController {
  constructor(private readonly service: SportTypesService) {}

  @Get()
  @ApiOperation({
    summary: 'List allowed sport types (reference data)',
    description:
      'The values `sportType` accepts on group and event create/update, in ' +
      'display order. Each row carries its `subTypes` — the formats an EVENT ' +
      'of that sport may set as `subType` (football: futsal, stadium); a ' +
      'sport with an empty list takes no subType at all. Read-only — rows ' +
      'are seeded server-side, so there is no create, update or delete.',
  })
  findAll() {
    return this.service.findAll();
  }
}
