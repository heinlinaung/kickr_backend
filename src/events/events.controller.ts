import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiQuery,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { UpdateEventStatusDto } from './dto/update-event-status.dto';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Get()
  @ApiQuery({
    name: 'region',
    required: false,
    example: 'Myanmar',
    description:
      "Filters by the owning group's country OR city (case-insensitive). " +
      'Events with no group are excluded when set.',
  })
  list(@CurrentUser() user: any, @Query('region') region?: string) {
    return this.eventsService.list(user._id.toString(), region);
  }

  /**
   * Declared BEFORE `@Get(':id')` on purpose — Nest matches routes in
   * declaration order, and `group` would otherwise be swallowed as an `:id`.
   */
  @Get('group/:groupId')
  @ApiOperation({
    summary: "All of one group's events, soonest first",
    description:
      'Approved members see every event in the group, public or private. ' +
      'Everyone else sees only the public ones. Optionally filter by ' +
      'lifecycle status.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'join',
    description:
      'Optional lifecycle filter: join | before_match | preparation | ' +
      'playing | after_match | done.',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  listByGroup(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Query('status') status?: string,
  ) {
    return this.eventsService.listByGroup(
      groupId,
      user._id.toString(),
      status,
    );
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user._id.toString(), dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.eventsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an event (organizer only, not once done)' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  @ApiResponse({ status: 400, description: 'Event is already done' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(id, user._id.toString(), dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an event (organizer only, not once done)' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.remove(id, user._id.toString());
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Advance the event lifecycle',
    description:
      'join -> before_match -> preparation -> playing -> after_match -> done. ' +
      'before_match may reopen to join, and preparation may revert to ' +
      'before_match. done is terminal.',
  })
  @ApiResponse({ status: 409, description: 'Illegal transition' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  setStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateEventStatusDto,
  ) {
    return this.eventsService.setStatus(id, user._id.toString(), dto.status);
  }

  @Post(':id/join')
  join(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.join(id, user._id.toString());
  }

  @Delete(':id/join')
  leave(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.leave(id, user._id.toString());
  }

  @Get(':id/players')
  players(@Param('id') id: string) {
    return this.eventsService.listPlayers(id);
  }
}
