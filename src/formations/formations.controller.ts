// src/formations/formations.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { FormationsService } from './formations.service';

@ApiTags('Formations')
@ApiBearerAuth()
@Controller('formations')
@UseGuards(JwtAuthGuard)
export class FormationsController {
  constructor(private readonly service: FormationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Global formation list (reference data)',
    description:
      'Suggested formations per squad size, for the formation picker — e.g. ' +
      "playerCount 11 offers '4-4-2', '4-3-3', … Suggestions only: " +
      'PUT /events/:id/teams/:teamId/formation accepts any shape whose ' +
      'arithmetic holds. Read-only — rows are seeded server-side.',
  })
  findAll() {
    return this.service.findAll();
  }
}
