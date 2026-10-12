// src/sport-types/sport-types.controller.ts
import {
  applyDecorators,
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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperadminGuard } from '../common/guards/superadmin.guard';
import { SportTypesService } from './sport-types.service';
import { CreateSportTypeDto } from './dto/create-sport-type.dto';
import { UpdateSportTypeDto } from './dto/update-sport-type.dto';
import { AddSubTypeDto } from './dto/add-sub-type.dto';
import { RenameSubTypeDto } from './dto/rename-sub-type.dto';

/**
 * Reads are for any signed-in user (JWT). Writes change the reference list
 * every group/event/user write validates against, so they also require the
 * caller's `role` to be 'superadmin'.
 * Guards are per-route rather than on the class because the two differ.
 */
const AdminWrite = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard, SuperadminGuard),
    ApiBearerAuth(),
    ApiResponse({ status: 401, description: 'Missing or invalid token' }),
    ApiResponse({ status: 403, description: 'Caller is not a superadmin' }),
  );

/** The `:value` path param, shared by every per-sport route. */
const ValueParam = ApiParam({
  name: 'value',
  description: 'The sport type value, e.g. `football` (case-insensitive)',
  example: 'football',
});

const ROW = '`{ value, subTypes, sortOrder, matchProvided }`';

@ApiTags('Sport types')
@Controller('sport-types')
export class SportTypesController {
  constructor(private readonly service: SportTypesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: `Array of ${ROW}, in display order`,
  })
  @ApiOperation({
    summary: 'List allowed sport types (reference data)',
    description:
      'The values `sportType` accepts on group and event create/update, in ' +
      'display order. Each row carries its `subTypes` — the formats an EVENT ' +
      'of that sport may set as `subType` (football: futsal, stadium); a ' +
      'sport with an empty list takes no subType at all.',
  })
  findAll() {
    return this.service.findAll();
  }

  @Get(':value')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ValueParam
  @ApiResponse({ status: 200, description: `The sport as ${ROW}` })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiOperation({ summary: 'One sport type by its value, e.g. football' })
  findOne(@Param('value') value: string) {
    return this.service.findOne(value);
  }

  @Post()
  @AdminWrite()
  @ApiResponse({ status: 201, description: `The created sport as ${ROW}` })
  @ApiResponse({
    status: 400,
    description: 'value or a subType is not a lowercase slug',
  })
  @ApiResponse({
    status: 409,
    description: 'A sport with this value already exists',
  })
  @ApiOperation({
    summary: 'Create a sport type (superadmin)',
    description:
      '`value` is lowercased and must be unique (409 otherwise). Omit ' +
      '`sortOrder` to append to the end of the list.',
  })
  create(@Body() dto: CreateSportTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':value')
  @AdminWrite()
  @ValueParam
  @ApiResponse({ status: 200, description: `The updated sport as ${ROW}` })
  @ApiResponse({
    status: 400,
    description: 'A subType is not a lowercase slug, or `value` was sent',
  })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiResponse({
    status: 409,
    description: 'A dropped subType is still used by an event or template',
  })
  @ApiOperation({
    summary: 'Update a sport type (superadmin)',
    description:
      'Changes `sortOrder` and/or `matchProvided`, and/or replaces the whole `subTypes` list. ' +
      '`value` cannot be renamed. Dropping a subType still used by an event ' +
      'or event template is refused with 409.',
  })
  update(@Param('value') value: string, @Body() dto: UpdateSportTypeDto) {
    return this.service.update(value, dto);
  }

  @Delete(':value')
  @AdminWrite()
  @ValueParam
  @ApiResponse({ status: 200, description: '`{ deleted: true, value }`' })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiResponse({
    status: 409,
    description:
      'Still stored on groups, events, templates or user profiles — the message gives the counts',
  })
  @ApiOperation({
    summary: 'Delete a sport type (superadmin)',
    description:
      'Refused with 409 while any group, event, event template or user ' +
      'profile still stores this value.',
  })
  remove(@Param('value') value: string) {
    return this.service.remove(value);
  }

  @Post(':value/sub-types')
  @AdminWrite()
  @ValueParam
  @ApiResponse({
    status: 201,
    description: `The sport, with the new subType, as ${ROW}`,
  })
  @ApiResponse({ status: 400, description: 'subType is not a lowercase slug' })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiResponse({
    status: 409,
    description: 'The sport already lists this subType',
  })
  @ApiOperation({
    summary: 'Add a subType to a sport type (superadmin)',
    description:
      'E.g. add `beach` to football. 409 if the sport already lists it.',
  })
  addSubType(@Param('value') value: string, @Body() dto: AddSubTypeDto) {
    return this.service.addSubType(value, dto.subType);
  }

  @Patch(':value/sub-types/:subType')
  @AdminWrite()
  @ValueParam
  @ApiParam({
    name: 'subType',
    description: 'The format to rename, e.g. `stadium` (case-insensitive)',
    example: 'stadium',
  })
  @ApiResponse({
    status: 200,
    description: `The sport, with the subType renamed, as ${ROW}`,
  })
  @ApiResponse({ status: 400, description: 'subType is not a lowercase slug' })
  @ApiResponse({
    status: 404,
    description: 'Sport type, or that subType on it, not found',
  })
  @ApiResponse({
    status: 409,
    description: 'The sport already lists the new name',
  })
  @ApiOperation({
    summary: 'Rename a subType of a sport type (superadmin)',
    description:
      'Renames in place, keeping its position in `subTypes`. Events and ' +
      'event templates of this sport storing the old name are moved to the ' +
      'new one. 409 if the sport already lists the new name.',
  })
  renameSubType(
    @Param('value') value: string,
    @Param('subType') subType: string,
    @Body() dto: RenameSubTypeDto,
  ) {
    return this.service.renameSubType(value, subType, dto.subType);
  }

  @Delete(':value/sub-types/:subType')
  @AdminWrite()
  @ValueParam
  @ApiParam({
    name: 'subType',
    description: 'The format to remove, e.g. `stadium` (case-insensitive)',
    example: 'stadium',
  })
  @ApiResponse({
    status: 200,
    description: `The sport, without the subType, as ${ROW}`,
  })
  @ApiResponse({
    status: 404,
    description: 'Sport type, or that subType on it, not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Still used by an event or event template of this sport',
  })
  @ApiOperation({
    summary: 'Remove a subType from a sport type (superadmin)',
    description:
      'Refused with 409 while any event or event template of this sport ' +
      'still uses the subType.',
  })
  removeSubType(
    @Param('value') value: string,
    @Param('subType') subType: string,
  ) {
    return this.service.removeSubType(value, subType);
  }
}
