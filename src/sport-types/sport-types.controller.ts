// src/sport-types/sport-types.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
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
import { ReorderSubTypesDto } from './dto/reorder-sub-types.dto';
import { RemoveSportTypeQueryDto } from './dto/remove-sport-type.dto';

/** The `:value` path param, shared by every per-sport route. */
const ValueParam = ApiParam({
  name: 'value',
  description:
    'The sport type ID (`value`), e.g. `football` (case-insensitive)',
  example: 'football',
});

const ROW = '`{ value, name, subTypes, sortOrder, matchProvided }`';

/**
 * Every route — reads included — requires the caller's `role` to be
 * 'superadmin'. Group/event/user writes still validate sportType through
 * SportTypesService directly, so they do not depend on these routes.
 */
@ApiTags('Sport types')
@UseGuards(JwtAuthGuard, SuperadminGuard)
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Missing or invalid token' })
@ApiResponse({ status: 403, description: 'Caller is not a superadmin' })
@Controller('sport-types')
export class SportTypesController {
  constructor(private readonly service: SportTypesService) {}

  @Get()
  @ApiResponse({
    status: 200,
    description: `Array of ${ROW}, in display order`,
  })
  @ApiOperation({
    summary: 'List sport types (superadmin)',
    description:
      'The values `sportType` accepts on group and event create/update, in ' +
      'display order, each with its `subTypes`. The apps read the same list ' +
      'from GET /configuration.',
  })
  findAll() {
    return this.service.findAll();
  }

  @Get(':value')
  @ValueParam
  @ApiResponse({ status: 200, description: `The sport as ${ROW}` })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiOperation({
    summary: 'One sport type by its value, e.g. football (superadmin)',
  })
  findOne(@Param('value') value: string) {
    return this.service.findOne(value);
  }

  @Post()
  @ApiResponse({ status: 201, description: `The created sport as ${ROW}` })
  @ApiResponse({
    status: 400,
    description: 'value or a subType is not a lowercase slug',
  })
  @ApiResponse({
    status: 409,
    description: 'A sport with this value or name already exists',
  })
  @ApiOperation({
    summary: 'Create a sport type (superadmin)',
    description:
      '`value` is the ID: lowercased, unique (409 otherwise) and never ' +
      'changes. `name` is the display label, defaulting to `value`. Omit ' +
      '`sortOrder` to append to the end of the list.',
  })
  create(@Body() dto: CreateSportTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':value')
  @ValueParam
  @ApiResponse({ status: 200, description: `The updated sport as ${ROW}` })
  @ApiResponse({
    status: 400,
    description: '`value` or `subTypes` was sent',
  })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiResponse({
    status: 409,
    description: 'Another sport already has this `name`',
  })
  @ApiOperation({
    summary: 'Update a sport type (superadmin)',
    description:
      'Changes `name`, `sortOrder` and/or `matchProvided`. `value` is the ' +
      'ID stored on groups, events and users and never changes — renaming ' +
      'only changes the display `name`. `subTypes` are managed through the ' +
      '`/sub-types` endpoints.',
  })
  update(@Param('value') value: string, @Body() dto: UpdateSportTypeDto) {
    return this.service.update(value, dto);
  }

  @Delete(':value')
  @ValueParam
  @ApiResponse({
    status: 200,
    description: '`{ deleted: true, value, replacedWith? }`',
  })
  @ApiResponse({
    status: 400,
    description: 'replaceWith is unknown or the sport being deleted',
  })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiResponse({
    status: 409,
    description:
      'No replaceWith, and still stored on groups, events, templates or user profiles — the message gives the counts',
  })
  @ApiOperation({
    summary: 'Delete a sport type (superadmin)',
    description:
      'Without `replaceWith`, refused with 409 while any group, event, ' +
      'event template or user profile still stores this value. With ' +
      '`?replaceWith=football`, all of them are moved to football first. ' +
      'Moved events and templates take this value as their subType when the ' +
      "replacement lists it (futsal → football + subType 'futsal'); " +
      'otherwise a subType the replacement does not list is cleared.',
  })
  remove(
    @Param('value') value: string,
    @Query() query: RemoveSportTypeQueryDto,
  ) {
    return this.service.remove(value, query.replaceWith);
  }

  @Post(':value/sub-types')
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

  @Put(':value/sub-types/order')
  @ValueParam
  @ApiResponse({
    status: 200,
    description: `The sport, with subTypes in the new order, as ${ROW}`,
  })
  @ApiResponse({
    status: 400,
    description: "subTypes is not exactly the sport's current subTypes",
  })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiOperation({
    summary: 'Reorder the subTypes of a sport type (superadmin)',
    description:
      'Send every current subType exactly once, in the new display order. ' +
      'Use the add, rename and remove routes to change which subTypes exist.',
  })
  reorderSubTypes(
    @Param('value') value: string,
    @Body() dto: ReorderSubTypesDto,
  ) {
    return this.service.reorderSubTypes(value, dto.subTypes);
  }

  @Patch(':value/sub-types/:subType')
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
