// src/countries/countries.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperadminGuard } from '../common/guards/superadmin.guard';
import { CountriesService } from './countries.service';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import { RegionDto, UpdateRegionDto } from './dto/region.dto';
import {
  CountryDeletedEnvelope,
  CountryEnvelope,
  CountryListEnvelope,
} from './dto/country-response.dto';

const IdParam = ApiParam({ name: 'id', example: 'myanmar' });
const RegionIdParam = ApiParam({ name: 'regionId', example: 'yangon' });

const ROW = '`{ id, name, sortOrder, regions: [{ id, name }] }`';

/**
 * Every route — reads included — requires the caller's `role` to be
 * 'superadmin'. The apps load regions through public GET /configuration.
 */
@ApiTags('Countries & regions')
@UseGuards(JwtAuthGuard, SuperadminGuard)
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Missing or invalid token' })
@ApiResponse({ status: 403, description: 'Caller is not a superadmin' })
@Controller('countries')
export class CountriesController {
  constructor(private readonly service: CountriesService) {}

  @Get()
  @ApiResponse({
    status: 200,
    type: CountryListEnvelope,
    description: `Array of ${ROW}, in display order`,
  })
  @ApiOperation({
    summary: 'List countries with their regions (superadmin)',
  })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @IdParam
  @ApiResponse({
    status: 200,
    type: CountryEnvelope,
    description: `The country as ${ROW}`,
  })
  @ApiResponse({ status: 404, description: 'Country not found' })
  @ApiOperation({
    summary: 'One country by id, e.g. myanmar (superadmin)',
  })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiResponse({
    status: 201,
    type: CountryEnvelope,
    description: `The created country as ${ROW}`,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid field, or duplicate region id in the body',
  })
  @ApiResponse({ status: 409, description: 'Country id already exists' })
  @ApiOperation({
    summary: 'Create a country (superadmin)',
    description:
      'Omitted ids are derived from `name`, lowercased. Ids are immutable ' +
      'afterwards — groups and users store them as `country` / `city`.',
  })
  create(@Body() dto: CreateCountryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @IdParam
  @ApiResponse({
    status: 200,
    type: CountryEnvelope,
    description: `The updated country as ${ROW}`,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid field, body id differs from the path id, or duplicate region id',
  })
  @ApiResponse({ status: 404, description: 'Country not found' })
  @ApiResponse({
    status: 409,
    description: 'A dropped region is still used by a group or user',
  })
  @ApiOperation({
    summary: 'Update a country (superadmin)',
    description:
      'Changes `name` / `sortOrder`, and/or replaces the whole `regions` ' +
      'list. `id` may be sent but must equal the path id — it cannot change. ' +
      'To add, rename, reorder or remove regions, send the full new list: ' +
      'regions left out are dropped (409 while still in use).',
  })
  update(@Param('id') id: string, @Body() dto: UpdateCountryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @IdParam
  @ApiResponse({
    status: 200,
    type: CountryDeletedEnvelope,
    description: '`{ deleted: true, id }`',
  })
  @ApiResponse({ status: 404, description: 'Country not found' })
  @ApiResponse({
    status: 409,
    description: 'Still stored as `country` on a group or user',
  })
  @ApiOperation({ summary: 'Delete a country (superadmin)' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/regions')
  @ApiExcludeEndpoint()
  @IdParam
  @ApiResponse({
    status: 201,
    type: CountryEnvelope,
    description: `The country as ${ROW}`,
  })
  @ApiResponse({ status: 404, description: 'Country not found' })
  @ApiResponse({ status: 409, description: 'Region id already exists' })
  @ApiOperation({ summary: 'Add a region to a country (superadmin)' })
  addRegion(@Param('id') id: string, @Body() dto: RegionDto) {
    return this.service.addRegion(id, dto);
  }

  @Patch(':id/regions/:regionId')
  @ApiExcludeEndpoint()
  @IdParam
  @RegionIdParam
  @ApiResponse({
    status: 200,
    type: CountryEnvelope,
    description: `The country as ${ROW}`,
  })
  @ApiResponse({ status: 404, description: 'Country or region not found' })
  @ApiOperation({
    summary: "Rename a region's display name (superadmin)",
    description: 'Only `name` changes; the region id is immutable.',
  })
  updateRegion(
    @Param('id') id: string,
    @Param('regionId') regionId: string,
    @Body() dto: UpdateRegionDto,
  ) {
    return this.service.updateRegion(id, regionId, dto.name);
  }

  @Delete(':id/regions/:regionId')
  @ApiExcludeEndpoint()
  @IdParam
  @RegionIdParam
  @ApiResponse({
    status: 200,
    type: CountryEnvelope,
    description: `The country as ${ROW}`,
  })
  @ApiResponse({ status: 404, description: 'Country or region not found' })
  @ApiResponse({
    status: 409,
    description: 'Still stored as `city` on a group or user in this country',
  })
  @ApiOperation({ summary: 'Remove a region from a country (superadmin)' })
  removeRegion(@Param('id') id: string, @Param('regionId') regionId: string) {
    return this.service.removeRegion(id, regionId);
  }
}
