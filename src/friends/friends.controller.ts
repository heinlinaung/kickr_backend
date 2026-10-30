import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  FriendEventRole,
  FriendEventStatus,
  FriendRequestDirection,
  FriendsService,
} from './friends.service';
import { SendFriendRequestDto } from './dto/send-friend-request.dto';
import { friendError } from './friends.errors';
import { CURSOR_QUERY, LIMIT_QUERY, oneOf, toLimit } from './friends.helpers';

const DIRECTIONS: FriendRequestDirection[] = ['incoming', 'outgoing'];
const EVENT_STATUSES: FriendEventStatus[] = ['upcoming', 'past', 'all'];
const EVENT_ROLES: FriendEventRole[] = ['participant', 'organizer'];

/**
 * Friend requests, the friend list, and read-only views of a friend's
 * profile, awards and events. Event invitations live in
 * EventInvitationsController.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('friend-requests')
  @ApiOperation({
    summary: 'Send a friend request',
    description:
      'If the other user already has a pending request to you, both resolve ' +
      'into a friendship at once and the response is 200 with ' +
      '`status: ACCEPTED`. A rejected requester must wait 30 days before ' +
      'asking the same user again. Limit: 50 requests per day.',
  })
  @ApiResponse({ status: 201, description: 'Request sent (PENDING)' })
  @ApiResponse({ status: 200, description: 'Mutual request — now friends' })
  async sendRequest(
    @CurrentUser() user: any,
    @Body() dto: SendFriendRequestDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, friendship } = await this.friendsService.sendRequest(
      user._id.toString(),
      dto.toUserId,
    );
    if (!created) res.status(200);
    return friendship;
  }

  @Get('friend-requests')
  @ApiOperation({ summary: 'List pending friend requests to or from me' })
  @ApiQuery({ name: 'direction', required: true, enum: DIRECTIONS })
  @ApiQuery(LIMIT_QUERY)
  @ApiQuery(CURSOR_QUERY)
  listRequests(
    @CurrentUser() user: any,
    @Query('direction') direction?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const dir = oneOf('direction', direction, DIRECTIONS);
    if (!dir) throw friendError('INVALID_REQUEST', 'direction is required');
    return this.friendsService.listRequests(user._id.toString(), dir, {
      limit: toLimit(limit),
      cursor,
    });
  }

  @Post('friend-requests/:requestId/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a friend request (addressee)' })
  approve(@CurrentUser() user: any, @Param('requestId') requestId: string) {
    return this.friendsService.respondToRequest(
      user._id.toString(),
      requestId,
      'ACCEPTED',
    );
  }

  @Post('friend-requests/:requestId/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Decline a friend request (addressee)',
    description: 'The requester is not notified.',
  })
  reject(@CurrentUser() user: any, @Param('requestId') requestId: string) {
    return this.friendsService.respondToRequest(
      user._id.toString(),
      requestId,
      'REJECTED',
    );
  }

  @Delete('friend-requests/:requestId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cancel my own pending friend request' })
  async cancelRequest(
    @CurrentUser() user: any,
    @Param('requestId') requestId: string,
  ) {
    await this.friendsService.cancelRequest(user._id.toString(), requestId);
  }

  @Get('friends')
  @ApiOperation({ summary: 'List my friends, sorted by display name' })
  @ApiQuery({ name: 'q', required: false, description: 'Name search' })
  @ApiQuery(LIMIT_QUERY)
  @ApiQuery(CURSOR_QUERY)
  listFriends(
    @CurrentUser() user: any,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.friendsService.listFriends(user._id.toString(), {
      q,
      limit: toLimit(limit),
      cursor,
    });
  }

  @Get('friends/:userId')
  @ApiOperation({
    summary: "A friend's profile summary",
    description:
      "Respects the friend's privacy settings: a private profile returns only " +
      'the identity card, and `showStats: false` omits `stats`.',
  })
  @ApiResponse({ status: 403, description: 'NOT_FRIENDS' })
  getFriend(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.friendsService.getFriendProfile(user._id.toString(), userId);
  }

  @Get('friends/:userId/awards')
  @ApiOperation({
    summary: "A friend's awards",
    description: 'Same items as GET /users/:userId/awards, newest first.',
  })
  @ApiQuery(LIMIT_QUERY)
  @ApiQuery(CURSOR_QUERY)
  @ApiResponse({ status: 403, description: 'NOT_FRIENDS' })
  getFriendAwards(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.friendsService.getFriendAwards(user._id.toString(), userId, {
      limit: toLimit(limit),
      cursor,
    });
  }

  @Get('friends/:userId/events')
  @ApiOperation({
    summary: 'Events a friend joined or organized',
    description:
      'Only events you are allowed to see: ones you are on, any event of a ' +
      'group you belong to, and public events outside private groups. ' +
      '`canInvite` says whether YOU can invite friends to it right now.',
  })
  @ApiQuery({ name: 'status', required: false, enum: EVENT_STATUSES })
  @ApiQuery({ name: 'role', required: false, enum: EVENT_ROLES })
  @ApiQuery(LIMIT_QUERY)
  @ApiQuery(CURSOR_QUERY)
  @ApiResponse({ status: 403, description: 'NOT_FRIENDS' })
  getFriendEvents(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.friendsService.getFriendEvents(user._id.toString(), userId, {
      status: oneOf('status', status, EVENT_STATUSES) ?? 'all',
      role: oneOf('role', role, EVENT_ROLES),
      limit: toLimit(limit),
      cursor,
    });
  }

  @Delete('friends/:userId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Unfriend',
    description:
      'Pending event invitations between the two of you are revoked. Events ' +
      'already joined are not affected.',
  })
  async unfriend(@CurrentUser() user: any, @Param('userId') userId: string) {
    await this.friendsService.unfriend(user._id.toString(), userId);
  }
}
