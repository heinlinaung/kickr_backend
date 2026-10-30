import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import {
  EventInvitationsService,
  InvitationListStatus,
} from './event-invitations.service';
import { CreateEventInvitationsDto } from './dto/create-event-invitations.dto';
import { CURSOR_QUERY, LIMIT_QUERY, oneOf, toLimit } from './friends.helpers';

const LIST_STATUSES: InvitationListStatus[] = [
  'pending',
  'accepted',
  'declined',
];

/** Inviting friends to events, and answering those invitations. */
@ApiTags('Event invitations')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class EventInvitationsController {
  constructor(private readonly invitationsService: EventInvitationsService) {}

  @Post('events/:eventId/invitations')
  @HttpCode(207)
  @ApiOperation({
    summary: 'Invite friends to an event',
    description:
      'Up to 50 friends per call; each is checked on its own, so some can ' +
      'succeed while others fail. The invitee does NOT need to be in the ' +
      "event's group — only a friendship is required. Event-level errors " +
      '(EVENT_NOT_FOUND, NOT_EVENT_PARTICIPANT, EVENT_CLOSED) fail the whole ' +
      'call. Limit: 200 invitations per day.',
  })
  @ApiResponse({ status: 207, description: 'Per-user results' })
  invite(
    @CurrentUser() user: any,
    @Param('eventId') eventId: string,
    @Body() dto: CreateEventInvitationsDto,
  ) {
    return this.invitationsService.invite(user._id.toString(), eventId, dto);
  }

  @Get('invitations')
  @ApiOperation({ summary: 'Event invitations I received, newest first' })
  @ApiQuery({ name: 'status', required: false, enum: LIST_STATUSES })
  @ApiQuery(LIMIT_QUERY)
  @ApiQuery(CURSOR_QUERY)
  list(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.invitationsService.listReceived(user._id.toString(), {
      status: oneOf('status', status, LIST_STATUSES) ?? 'pending',
      limit: toLimit(limit),
      cursor,
    });
  }

  @Post('invitations/:invitationId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an invitation and join the event' })
  accept(
    @CurrentUser() user: any,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitationsService.accept(user._id.toString(), invitationId);
  }

  @Post('invitations/:invitationId/decline')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Decline an invitation',
    description: 'The inviter is not notified.',
  })
  decline(
    @CurrentUser() user: any,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitationsService.decline(user._id.toString(), invitationId);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a pending invitation I sent' })
  async revoke(
    @CurrentUser() user: any,
    @Param('invitationId') invitationId: string,
  ) {
    await this.invitationsService.revoke(user._id.toString(), invitationId);
  }
}
