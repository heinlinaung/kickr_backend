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
import { GenerateTeamsDto } from './dto/generate-teams.dto';
import { AssignTeamPlayersDto } from './dto/assign-team-players.dto';
import { AddMatchDto } from './dto/add-match.dto';
import { UpdateMatchScoreDto } from './dto/update-match-score.dto';
import { SubmitResultDto } from './dto/submit-result.dto';
import { SetPaymentDto } from './dto/set-payment.dto';
import { AddGuestDto } from './dto/add-guest.dto';
import { SetGuestApprovalDto } from './dto/set-guest-approval.dto';
import { SetTeamMemberRoleDto } from './dto/set-team-member-role.dto';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Get()
  @ApiOperation({
    summary: 'Discover events',
    description:
      'Every PUBLIC event, plus every event the caller has joined — private ' +
      'ones included, because being on the roster is the permission. Each row ' +
      'carries `joinedByMe`, so a mixed list can be told apart; do not assume ' +
      'a row from here is public. Roster membership is the test, not group ' +
      'membership: a private event you have not joined stays hidden even from ' +
      "a member of the owning group — use GET /events/group/:groupId for a " +
      'group schedule. FINISHED events are hidden by default: `after_match` ' +
      'and `done` are excluded unless asked for explicitly, since a played ' +
      'fixture is history rather than something to turn up to. An explicit ' +
      '?status=done or ?status=after_match still returns them. NOTE: there is ' +
      'still NO default DATE filter here, unlike /events/joined and ' +
      '/events/group/:groupId — a past-dated event that is still `join` or ' +
      '`playing` is returned unless narrowed with ?from=.',
  })
  @ApiQuery({
    name: 'region',
    required: false,
    example: 'Myanmar',
    description:
      "Filters by the owning group's country OR city. Group values are " +
      'stored lowercase and the input is lowercased before matching, so ' +
      'casing does not matter. Exact whole-value match, not a substring. ' +
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
   * Declared BEFORE `@Get(':id')` — same reason as `joined` below: a bare
   * `search` would otherwise be matched as an event id and 404.
   */
  @Get('search')
  @ApiOperation({
    summary: 'Free-text search over public events',
    description:
      'Case-insensitive substring match on title and description, soonest ' +
      'first. Public events only — a private group event never surfaces ' +
      'here, even to a member; use GET /events/group/:groupId for those. ' +
      'Expired and `done` events are hidden unless includeExpired=true. ' +
      'Returns a page: `{ items, nextCursor, hasMore }`. Ordered by date ' +
      'ascending, not by relevance. An empty query returns an empty page.',
  })
  @ApiQuery({ name: 'q', required: true, example: 'friday night' })
  @ApiQuery({
    name: 'includeExpired',
    required: false,
    example: false,
    description: 'Include past and `done` events. Defaults to false.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Page size, 1-50. Defaults to 20.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description:
      'Opaque pagination cursor. Pass `nextCursor` from the previous ' +
      'response verbatim; omit for the first page. Invalid values give 400.',
  })
  searchEvents(
    @Query('q') q?: string,
    @Query('includeExpired') includeExpired?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.eventsService.search(
      q ?? '',
      includeExpired === 'true',
      limit === undefined ? undefined : Number(limit),
      cursor,
    );
  }

  /**
   * Declared BEFORE `@Get(':id')` on purpose — Nest matches routes in
   * declaration order, and `joined` would otherwise be swallowed as an `:id`
   * (yielding a 404 for a malformed ObjectId rather than this list).
   *
   * Named for the RELATIONSHIP, not possession: a user also *owns* events they
   * created, so `/events/mine` read as "events I created" — the opposite of
   * what this returns. It also leaves `/events/created` free for that.
   */
  @Get('joined')
  @ApiOperation({
    summary: 'Events the caller has joined, soonest first',
    description:
      'Every event where the caller is on the roster — including private ' +
      'group events, which GET /events cannot show. Expired and `done` ' +
      'events are hidden unless includeExpired=true. An event you have left ' +
      'is excluded.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'join',
    description: 'Optional lifecycle filter.',
  })
  @ApiQuery({
    name: 'includeExpired',
    required: false,
    example: false,
    description:
      'Expired events (date before today) and `done` events are hidden by ' +
      'default. Set true for the history view.',
  })
  listJoined(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.eventsService.listJoined(
      user._id.toString(),
      status,
      includeExpired === 'true',
    );
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
      'Everyone else sees only the public ones. Expired and `done` events are ' +
      'excluded unless includeExpired=true. Optionally filter by lifecycle ' +
      'status.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'join',
    description:
      'Optional lifecycle filter: join | preparation | ready_to_play | ' +
      'playing | after_match | done.',
  })
  @ApiQuery({
    name: 'includeExpired',
    required: false,
    example: false,
    description:
      'Expired events (date before today) and `done` events are hidden by ' +
      'default. Set true for the history view.',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  listByGroup(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.eventsService.listByGroup(
      groupId,
      user._id.toString(),
      status,
      includeExpired === 'true',
    );
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user._id.toString(), dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Event detail, with everything a detail screen needs',
    description:
      'Beyond the event document, this resolves the things a detail screen ' +
      'would otherwise fetch separately: `group` ({ _id, name, logo, ' +
      'wallpaper }, null for a standalone event), `groupRules`, `location` ' +
      '(resolved venue object), `teams` (players populated), `matches`, ' +
      'derived `standings`, plus `userRole` (the caller\'s GROUP role), ' +
      '`joinedByMe` (whether the caller is on the ROSTER — not the same ' +
      'thing) and `likedByMe`. `group` and `groupRules` are read-only ' +
      'projections; edit them via PATCH /groups/:id. An invalid or unknown ' +
      'id is a 404, never a 500.',
  })
  @ApiResponse({ status: 404, description: 'No such event, or a malformed id' })
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
      'join -> preparation -> ready_to_play -> playing -> after_match -> ' +
      'done. ready_to_play is where the teams are final and reviewable but ' +
      'the match has not kicked off — the roster is frozen, so shuffling is ' +
      'refused there. Two reverse edges: preparation may revert to join ' +
      '(reopening registration), and ready_to_play may revert to ' +
      'preparation (to re-shuffle a wrong team set). done is terminal. ' +
      'BREAKING: preparation -> playing is no longer legal and now 409s — ' +
      'kick-off must pass through ready_to_play.',
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

  /**
   * Note the two ids: `:id` is the event, `:userId` is the player being
   * removed. The organizer is taken from the token, never from the path.
   */
  @Delete(':id/players/:userId')
  @ApiOperation({
    summary: 'Remove a player from the event (organizer)',
    description:
      'Organizer-only, and only while the event is in `join` — past that ' +
      'teams and fixtures reference the roster, so reopen registration ' +
      '(preparation -> join) before removing anyone. The roster row is ' +
      'cancelled rather than deleted, so it reactivates if they rejoin, and ' +
      '`joinedCount` is decremented. Use DELETE /events/:id/join for the ' +
      'caller leaving of their own accord.',
  })
  @ApiResponse({ status: 400, description: 'Event is past `join`' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  @ApiResponse({
    status: 404,
    description: 'Unknown event, or that user has not joined',
  })
  removePlayer(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: any,
  ) {
    return this.eventsService.removePlayer(
      id,
      user._id.toString(),
      targetUserId,
    );
  }

  // --- Teams & fixtures (spec §4.3) ---------------------------------------

  @Post(':id/teams/generate')
  @ApiOperation({
    summary: 'Create the teams and the fixture list (organizer, preparation)',
    description:
      'Creates `teamsCount` EMPTY teams and the FULL double round-robin ' +
      'fixture list — every pair meets twice, so n teams produce n*(n-1) ' +
      'matches (2 teams = 2, 3 = 6, 4 = 12). The list is no longer trimmed ' +
      'to what fits the booked slot, which is why GET /events/:id/matches ' +
      'used to show only two or three fixtures. ' +
      'Name the teams by sending `colors` — one per team, length must equal ' +
      'teamsCount, and they must be distinct. Spelling is NOT validated, so ' +
      'any label is accepted. Omit `colors` to use the built-in vocabulary. ' +
      'Returns ONLY a success message: read the teams back from ' +
      'GET /events/:id/teams (you need their ids to assign players) and the ' +
      'fixtures from GET /events/:id/matches. ' +
      'Assign players with PATCH /events/:id/teams/:teamId. ' +
      'Re-running replaces the previous teams and fixtures. ' +
      'SIDE EFFECT: teamsCount is written to event.teamCount, so a later ' +
      'POST /events/:id/shuffle — which takes no body and reads only that ' +
      'field — reproduces the same split.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Teams and fixtures created. The body carries a message and nothing ' +
      'else — teams, matches, matchCount and schedule are no longer returned.',
    schema: {
      example: { data: { message: 'Teams created successfully' } },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'colors length does not equal teamsCount, colours are not distinct, ' +
      'match duration does not fit the event, or wrong state',
  })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  generateTeams(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: GenerateTeamsDto,
  ) {
    return this.eventsService.generateTeams(id, user._id.toString(), dto);
  }

  // --- Guests (+1 / +2) ----------------------------------------------------

  @Post(':id/guests')
  @ApiOperation({
    summary: 'Add a guest who has no account (+1 / +2)',
    description:
      'The caller must already have JOINED the event — a guest is somebody ' +
      "else's plus-one. `join` state only. Created PENDING: the guest is not " +
      'on the roster and does not count toward capacity until an organizer ' +
      'approves them. At most 2 guests per member, counting pending and ' +
      'approved but not rejected, so a rejection does not burn an allowance. ' +
      'A guest has no account: `guestName` is all the system knows.',
  })
  @ApiResponse({ status: 400, description: 'Not in `join`, or allowance used' })
  @ApiResponse({ status: 403, description: 'Caller has not joined the event' })
  addGuest(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: AddGuestDto,
  ) {
    return this.eventsService.addGuest(id, user._id.toString(), dto);
  }

  @Get(':id/guests')
  @ApiOperation({
    summary: 'Guests on the event',
    description:
      'An organizer sees every guest, since they decide. Anyone else sees ' +
      'approved guests plus their OWN pending and rejected ones — you can ' +
      'follow the decision on someone you brought without reading everyone ' +
      "else's pending list. Approved guests also appear in " +
      'GET /events/:id/players with `type: "guest"`.',
  })
  listGuests(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.listGuests(id, user._id.toString());
  }

  @Patch(':id/guests/:guestId/approval')
  @ApiOperation({
    summary: 'Approve or reject a guest (organizer)',
    description:
      'Approving is what puts the guest on the roster and increments ' +
      '`joinedCount`. Capacity is a SOFT limit: an approved guest may push the ' +
      'event past `maxPlayers` rather than being refused, which makes `isFull` ' +
      'true and closes joining for everyone else. Rejecting leaves them off ' +
      'the roster. Idempotent — re-approving does not count twice. `pending` ' +
      'is not an accepted value.',
  })
  @ApiResponse({ status: 400, description: 'Malformed guest id' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  @ApiResponse({ status: 404, description: 'Guest not found for this event' })
  setGuestApproval(
    @Param('id') id: string,
    @Param('guestId') guestId: string,
    @CurrentUser() user: any,
    @Body() dto: SetGuestApprovalDto,
  ) {
    return this.eventsService.setGuestApproval(
      id,
      user._id.toString(),
      guestId,
      dto,
    );
  }

  @Delete(':id/guests/:guestId')
  @ApiOperation({
    summary: 'Withdraw a guest (sponsor or organizer)',
    description:
      'Callable by the member who added the guest, or by an organizer. The ' +
      'row is cancelled rather than deleted, so it survives as a record of ' +
      'who was brought and what was decided. An approved guest gives their ' +
      'capacity back.',
  })
  @ApiResponse({ status: 403, description: 'Neither the sponsor nor an organizer' })
  @ApiResponse({ status: 404, description: 'Guest not found for this event' })
  removeGuest(
    @Param('id') id: string,
    @Param('guestId') guestId: string,
    @CurrentUser() user: any,
  ) {
    return this.eventsService.removeGuest(id, user._id.toString(), guestId);
  }

  // --- Payments ------------------------------------------------------------

  @Get(':id/payments')
  @ApiOperation({
    summary: 'Payment status for the event',
    description:
      'Role-aware: an organizer gets every member, anyone else gets only ' +
      'their own row. A member with no row yet is simply absent — that means ' +
      '"not recorded", which is deliberately distinct from "recorded as ' +
      'unpaid". The amount is not stored per member; it comes from the ' +
      "event's `price` plus `additionalPrice` when `takeAdditionalPrice` is " +
      'set.',
  })
  @ApiResponse({ status: 404, description: 'Event not found' })
  listPayments(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.listPayments(id, user._id.toString());
  }

  @Patch(':id/payments/:memberId')
  @ApiOperation({
    summary: 'Mark a member paid or unpaid (organizer)',
    description:
      'Upserts, so the first call for a member creates their record. The ' +
      'member must be on the roster. `paidAt` is stamped when isPaid becomes ' +
      'true and cleared when a payment is reversed, so it never reads as a ' +
      'payment date for someone currently unpaid.',
  })
  @ApiResponse({ status: 400, description: 'Malformed member id' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  @ApiResponse({
    status: 404,
    description: 'Unknown event, or that member has not joined',
  })
  setPayment(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: any,
    @Body() dto: SetPaymentDto,
  ) {
    return this.eventsService.setPayment(
      id,
      user._id.toString(),
      memberId,
      dto,
    );
  }

  @Get(':id/teams')
  @ApiOperation({ summary: "The event's teams, with players populated" })
  teams(@Param('id') id: string) {
    return this.eventsService.listTeams(id);
  }

  @Patch(':id/teams/:teamId')
  @ApiOperation({
    summary: 'Assign or re-assign one team’s roster (organizer, preparation)',
    description:
      'Replaces the team’s players outright — the client shuffles locally and ' +
      'the organizer may hand-edit. Every id must be a joined player, and a ' +
      'player already in another team is refused by name. Optionally renames ' +
      'the team in the same call.',
  })
  @ApiResponse({ status: 400, description: 'Invalid roster, or wrong state' })
  @ApiResponse({ status: 404, description: 'No such team on this event' })
  assignTeamPlayers(
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @CurrentUser() user: any,
    @Body() dto: AssignTeamPlayersDto,
  ) {
    return this.eventsService.assignTeamPlayers(
      id,
      teamId,
      user._id.toString(),
      dto,
    );
  }

  @Patch(':id/teams/:teamId/members/:userId/role')
  @ApiOperation({
    summary: "Set a player's role within a team (owner/admin/captain)",
    description:
      'Roles are `player` (default) and `captain`. The player must already ' +
      'be assigned to the team — assign them with ' +
      'PATCH /events/:id/teams/:teamId first. Setting `player` clears an ' +
      'existing captaincy; the default is stored as absence, so it is not ' +
      'echoed back on team reads. A group `captain` may call this, unlike ' +
      'most team routes, since naming a captain is squad management. Roles ' +
      'are dropped automatically if the player is later removed from the team.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Malformed ids, the player is not in this team, or the event is done',
  })
  @ApiResponse({ status: 403, description: 'Caller may not manage team roles' })
  @ApiResponse({ status: 404, description: 'Team not found for this event' })
  setTeamMemberRole(
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: any,
    @Body() dto: SetTeamMemberRoleDto,
  ) {
    return this.eventsService.setTeamMemberRole(
      id,
      teamId,
      userId,
      user._id.toString(),
      dto,
    );
  }

  @Post(':id/matches')
  @ApiOperation({
    summary: 'Add one fixture by hand (organizer only)',
    description:
      'An escape hatch for schedules the generator cannot express — e.g. 3 ' +
      'teams in a 60-minute event fits only one match, leaving a team with no ' +
      'fixture. Appends a single match; does NOT renumber, check the double ' +
      'round-robin, or check the duration budget. Both team names must belong ' +
      'to this event. Created unplayed — score it via PATCH as usual. ' +
      'OPTIONAL `duration` (minutes): omit it and the fixture inherits the ' +
      'duration the existing ones are scheduled at; pass it for a one-off ' +
      'longer or shorter game. ' +
      'NOTE: a later /teams/generate or /shuffle replaces the whole fixture ' +
      'list, so add after generating, not before.',
  })
  @ApiResponse({
    status: 400,
    description: 'Unknown team name, a team against itself, or no teams yet',
  })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  addMatch(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: AddMatchDto,
  ) {
    return this.eventsService.addMatch(id, user._id.toString(), dto);
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
