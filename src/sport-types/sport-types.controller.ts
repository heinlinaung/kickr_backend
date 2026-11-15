// src/sport-types/sport-types.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { RemoveSportTypeQueryDto } from './dto/remove-sport-type.dto';

/** The `:value` path param, shared by every per-sport route. */
const ValueParam = ApiParam({
  name: 'value',
  description:
    'The sport type ID (`value`), e.g. `football` (case-insensitive)',
  example: 'football',
});

const ROW =
  '`{ value, name, subTypes: [{ value, name, sortOrder }], playerRoles, sortOrder, matchProvided }`';

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
      'display order, each with its `subTypes` (also in display order). The ' +
      'apps read the same list ' +
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
    description:
      'value, a playerRole or a subType value is not a lowercase slug, or a ' +
      'subType value is repeated',
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
      '`sortOrder` to append to the end of the list. `subTypes` are the ' +
      'formats events of this sport may use, e.g. ' +
      '`[{ value: "futsal", name: "Futsal", sortOrder: 1 }]`.',
  })
  create(@Body() dto: CreateSportTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':value')
  @ValueParam
  @ApiResponse({ status: 200, description: `The updated sport as ${ROW}` })
  @ApiResponse({
    status: 400,
    description: '`value` was sent, or a subType value is invalid or repeated',
  })
  @ApiResponse({ status: 404, description: 'Sport type not found' })
  @ApiResponse({
    status: 409,
    description:
      'Another sport already has this `name`, or a removed subType is still ' +
      'used by an event or event template',
  })
  @ApiOperation({
    summary: 'Update a sport type (superadmin)',
    description:
      'Changes `name`, `sortOrder`, `matchProvided`, `playerRoles` and/or ' +
      '`subTypes` (both replaced as a whole list). `value` is the ' +
      'ID stored on groups, events and users and never changes — renaming ' +
      'only changes the display `name`. The same goes for a subType: keep its ' +
      '`value` and change its `name`. A subType left out of the list is ' +
      'removed, refused with 409 while an event or event template uses it.',
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
}
