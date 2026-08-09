import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiQuery,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { multerMemoryImageOptions } from '../common/upload/multer-memory.config';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { UpdateEventStatusDto } from './dto/update-event-status.dto';
import { SubmitTeamsDto } from './dto/submit-teams.dto';
import { UpdateMatchScoreDto } from './dto/update-match-score.dto';
import { SubmitResultDto } from './dto/submit-result.dto';

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
  @ApiQuery({
    name: 'near',
    required: false,
    example: '16.8409,96.1735',
    description: "Latitude,longitude. Pairs with `radius`.",
  })
  @ApiQuery({
    name: 'radius',
    required: false,
    example: 10000,
    description: 'Search radius in metres around `near`. Defaults to 10000.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-08-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-08-31' })
  @ApiQuery({ name: 'status', required: false, example: 'join' })
  list(
    @CurrentUser() user: any,
    @Query('region') region?: string,
    @Query('near') near?: string,
    @Query('radius') radius?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.eventsService.list(user._id.toString(), {
      region,
      near,
      radius: radius === undefined ? undefined : Number(radius),
      from,
      to,
      status,
    });
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
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.findById(id, user._id.toString());
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

  // --- Teams & fixtures (spec §4.3) ---------------------------------------

  @Put(':id/teams')
  @ApiOperation({
    summary: 'Submit the finalized team list (organizer, preparation only)',
    description:
      'The client shuffles; the server validates the roster, persists it, ' +
      'generates the double round-robin fixtures, creates one chat per team ' +
      'and notifies each assigned player. Idempotent — the same body twice ' +
      'leaves the same state. Returns unassignedPlayerIds for any joined ' +
      'player left off a team (partial rosters are legal).',
  })
  @ApiResponse({ status: 400, description: 'Invalid roster, or wrong state' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  submitTeams(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: SubmitTeamsDto,
  ) {
    return this.eventsService.submitTeams(id, user._id.toString(), dto);
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Fixture list, in match order' })
  matches(@Param('id') id: string) {
    return this.eventsService.listMatches(id);
  }

  @Patch(':id/matches/:matchNumber')
  @ApiOperation({
    summary: 'Enter or correct one fixture score',
    description:
      'Allowed while playing and after_match, so a typo can still be fixed ' +
      'after the whistle. Both scores are required; 0 is a real scoreline.',
  })
  @ApiResponse({ status: 404, description: 'No such fixture number' })
  setMatchScore(
    @Param('id') id: string,
    @Param('matchNumber', ParseIntPipe) matchNumber: number,
    @CurrentUser() user: any,
    @Body() dto: UpdateMatchScoreDto,
  ) {
    return this.eventsService.setMatchScore(
      id,
      user._id.toString(),
      matchNumber,
      dto,
    );
  }

  @Get(':id/standings')
  @ApiOperation({
    summary: 'Standings table, derived on read',
    description:
      'Win 3 / draw 1 / loss 0, ordered by points, goal difference, goals ' +
      'for, then name. Fixtures with no score are skipped as unplayed.',
  })
  standings(@Param('id') id: string) {
    return this.eventsService.standings(id);
  }

  // --- After-match (spec §4.4) --------------------------------------------

  @Post(':id/result')
  @ApiOperation({ summary: 'Record MVP and optional overall score' })
  @ApiResponse({ status: 400, description: 'MVP did not join, or wrong state' })
  submitResult(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: SubmitResultDto,
  ) {
    return this.eventsService.submitResult(id, user._id.toString(), dto);
  }

  @Post(':id/cover')
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  @ApiOperation({ summary: 'Set or replace the cover image' })
  setCover(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.eventsService.setCover(id, user._id.toString(), file);
  }

  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  @ApiOperation({ summary: 'Add an after-match photo (after_match only)' })
  addPhoto(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.eventsService.addPhoto(id, user._id.toString(), file);
  }

  @Delete(':id/photos/:fileId')
  @ApiOperation({ summary: 'Remove an after-match photo' })
  removePhoto(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: any,
  ) {
    return this.eventsService.removePhoto(id, user._id.toString(), fileId);
  }

  // --- Likes (spec §4.5) --------------------------------------------------

  @Post(':id/like')
  @ApiOperation({ summary: 'Like an event (idempotent)' })
  like(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.like(id, user._id.toString());
  }

  @Delete(':id/like')
  @ApiOperation({ summary: 'Remove a like (idempotent)' })
  unlike(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.unlike(id, user._id.toString());
  }
}
