// src/challenges/challenges.controller.ts
import {
  Body,
  Controller,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsService } from '../events/events.service';
import { CreateChallengeEventDto } from '../events/dto/create-challenge-event.dto';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { RespondChallengeDto } from './dto/respond-challenge.dto';
import { CancelChallengeDto } from './dto/cancel-challenge.dto';

@ApiTags('Challenges')
@ApiBearerAuth()
@Controller('challenges')
@UseGuards(JwtAuthGuard)
export class ChallengesController {
  constructor(
    private readonly challenges: ChallengesService,
    private readonly events: EventsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Challenge another group (owner/admin of the challenger group)',
    description:
      'Creates a group-vs-group challenge in status `proposed` and notifies ' +
      "the challenged group's owner/admins. One PENDING challenge per group " +
      'pair at a time; a rematch after a verdict is a new challenge.',
  })
  @ApiResponse({
    status: 400,
    description: 'Self-challenge or one already pending',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not a challenger-group admin',
  })
  create(@CurrentUser() user: any, @Body() dto: CreateChallengeDto) {
    return this.challenges.create(user._id.toString(), dto);
  }

  @Get()
  @ApiOperation({
    summary: "A group's challenges, both directions (members)",
    description:
      'Pass `history=true` to get only closed challenges: cancelled, ' +
      'rejected more than 3 days ago, or finished (accepted and its match ' +
      'event is `done` or its time has passed — `endTime`, else `date` + ' +
      '`duration`). Without it, every challenge is returned except ' +
      'rejections older than 3 days, which live only in history.',
  })
  @ApiQuery({ name: 'groupId', type: String })
  @ApiQuery({
    name: 'history',
    type: Boolean,
    required: false,
    description:
      'true → only finished, cancelled, and rejected (3+ days ago) challenges',
  })
  list(
    @CurrentUser() user: any,
    @Query('groupId') groupId: string,
    @Query('history') history?: string,
  ) {
    return this.challenges.listForGroup(
      groupId,
      user._id.toString(),
      history === 'true',
    );
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Unread incoming challenges for a group (members)',
    description:
      'Counts challenges this group RECEIVED that have not been read yet. ' +
      'Set when another group sends a challenge; cleared by ' +
      'PATCH /challenges/read.',
  })
  @ApiQuery({ name: 'groupId', type: String })
  @ApiResponse({ status: 403, description: 'Not a member of this group' })
  unreadCount(@CurrentUser() user: any, @Query('groupId') groupId: string) {
    return this.challenges.unreadCount(groupId, user._id.toString());
  }

  @Patch('read')
  @ApiOperation({
    summary: "Mark a group's incoming challenges as read (owner/admin)",
    description:
      'Clears the unread challenge count for the receiving group. Idempotent.',
  })
  @ApiQuery({ name: 'groupId', type: String })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an owner/admin of the group',
  })
  markRead(@CurrentUser() user: any, @Query('groupId') groupId: string) {
    return this.challenges.markRead(groupId, user._id.toString());
  }

  @Patch(':id/respond')
  @ApiOperation({
    summary: 'Accept or reject a challenge (challenged group owner/admin)',
    description:
      '`action` accept|reject with an OPTIONAL reason. Only a `proposed` ' +
      'challenge can be answered; the verdict is final for that challenge.',
  })
  @ApiResponse({ status: 400, description: 'Already answered' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not a challenged-group admin',
  })
  respond(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: RespondChallengeDto,
  ) {
    return this.challenges.respond(id, user._id.toString(), dto);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a challenge (owner/admin)',
    description:
      'Soft cancel: status becomes `cancelled` and the row keeps ' +
      '`cancelReason`/`cancelledBy`/`cancelledAt`, so both groups still see ' +
      'it in their history. `reason` is OPTIONAL and is sent to the other ' +
      "group's owner/admins. A `proposed` challenge can be withdrawn only by " +
      'the CHALLENGER side (the challenged side rejects instead). An ' +
      '`accepted` challenge can be cancelled by either side until its match ' +
      'event is proposed — after that, cancel the event via ' +
      'POST /events/:id/cancel. Cancelling frees the pair to issue a new ' +
      'challenge straight away.',
  })
  @ApiResponse({ status: 201, description: 'The cancelled challenge' })
  @ApiResponse({
    status: 400,
    description:
      'Already rejected/cancelled, or the accepted challenge already has its match event',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an owner/admin of a group allowed to cancel it',
  })
  @ApiResponse({ status: 404, description: 'Challenge not found' })
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: CancelChallengeDto,
  ) {
    return this.challenges.cancel(id, user._id.toString(), dto);
  }

  @Post(':id/event')
  @ApiOperation({
    summary: 'Propose the match event for an ACCEPTED challenge',
    description:
      "Either side's owner/admin. Normal event body plus both kit colors " +
      '(`challengerColor`, `challengedColor`). The event is forced private, ' +
      "typed 'challenge', and starts at proposedStatus 'proposed' — inert " +
      'until the other side accepts via PATCH /events/:id/proposal/review. ' +
      'One challenge, one event; it counts toward your weekly plan limit.',
  })
  @ApiResponse({
    status: 400,
    description: 'Challenge not accepted, or it already has its event',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an admin of either group',
  })
  createEvent(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: CreateChallengeEventDto,
  ) {
    return this.events.createChallengeEvent(id, user._id.toString(), dto);
  }
}
