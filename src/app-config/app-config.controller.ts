import {
  applyDecorators,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperadminGuard } from '../common/guards/superadmin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppConfigService } from './app-config.service';
import { CreateAppConfigDto } from './dto/create-app-config.dto';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';

const ROW =
  '`{ revision, appUpdate, majorUpdate, features, updatedBy, createdAt }`';

/** Guards + Swagger auth docs for the superadmin-only write routes. */
const SuperadminOnly = applyDecorators(
  UseGuards(JwtAuthGuard, SuperadminGuard),
  ApiBearerAuth(),
  ApiResponse({ status: 401, description: 'Missing or invalid token' }),
  ApiResponse({ status: 403, description: 'Caller is not a superadmin' }),
);

/**
 * The live config is read through GET /configuration. The history GETs here
 * are public (no token); POST/PATCH are superadmin only. There is
 * deliberately no DELETE: revisions are the history.
 */
@ApiTags('App config')
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly service: AppConfigService) {}

  @Get('history')
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({
    name: 'before',
    required: false,
    description:
      'Only revisions below this one — pass the last row’s revision to page',
  })
  @ApiResponse({
    status: 200,
    description: `Array of ${ROW}, newest first (the first row is the live one)`,
  })
  @ApiOperation({ summary: 'App config history (public)' })
  findHistory(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ) {
    return this.service.findHistory(Math.min(Math.max(limit, 1), 100), before);
  }

  @Get('history/:revision')
  @ApiParam({ name: 'revision', example: 3 })
  @ApiResponse({ status: 200, description: `The revision as ${ROW}` })
  @ApiResponse({ status: 404, description: 'Revision not found' })
  @ApiOperation({ summary: 'One app config revision (public)' })
  findRevision(@Param('revision', ParseIntPipe) revision: number) {
    return this.service.findRevision(revision);
  }

  @Post()
  @SuperadminOnly
  @ApiResponse({
    status: 201,
    description: `The new latest revision as ${ROW}`,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid field or minimumVersion above latestVersion',
  })
  @ApiOperation({
    summary: 'Save a complete app config (superadmin)',
    description:
      'Saves the full body as a new revision, which becomes the latest. ' +
      'The previous revision stays in the history.',
  })
  create(@Body() dto: CreateAppConfigDto, @CurrentUser() user: any) {
    return this.service.create(dto, String(user._id));
  }

  @Patch()
  @SuperadminOnly
  @ApiResponse({
    status: 200,
    description: `The new latest revision as ${ROW}`,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid field or minimumVersion above latestVersion',
  })
  @ApiResponse({ status: 404, description: 'No config has been saved yet' })
  @ApiOperation({
    summary: 'Change part of the app config (superadmin)',
    description:
      'Send only the fields to change, e.g. `{ appUpdate: { ios: { ' +
      'latestVersion: "1.0.2" } } }`. They are applied on top of the latest ' +
      'revision and saved as a NEW revision; the previous one is kept ' +
      'unchanged in the history.',
  })
  update(@Body() dto: UpdateAppConfigDto, @CurrentUser() user: any) {
    return this.service.update(dto, String(user._id));
  }
}
