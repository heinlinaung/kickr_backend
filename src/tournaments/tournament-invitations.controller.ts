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
  INVITATION_LIST_STATUSES,
  InvitationListStatus,
  TournamentInvitationsService,
} from './tournament-invitations.service';
import {
  AcceptTournamentInvitationDto,
  CreateTournamentInvitationsDto,
  MAX_GROUPS_PER_INVITE,
} from './dto/tournament-invitation.dto';
import { tournamentError } from './tournaments.errors';

function toStatus(value?: string): InvitationListStatus | undefined {
  if (value === undefined) return undefined;
  if (!INVITATION_LIST_STATUSES.includes(value as InvitationListStatus)) {
    throw tournamentError(
      'INVALID_REQUEST',
      `status must be one of: ${INVITATION_LIST_STATUSES.join(', ')}`,
    );
  }
  return value as InvitationListStatus;
}

/** The organizer inviting groups (clubs) to a tournament, and their answers. */
@ApiTags('Tournament invitations')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class TournamentInvitationsController {
  constructor(
    private readonly invitationsService: TournamentInvitationsService,
  ) {}

  @Post('tournaments/:id/invitations')
  @HttpCode(207)
  @ApiOperation({
    summary: 'Invite groups (clubs) to enter a team (organizer)',
    description:
      `Up to ${MAX_GROUPS_PER_INVITE} groups per call; each is checked on its own, so some can succeed ` +
      'while others fail. The owner and admins of each invited group get a notification ' +
      '(`type: tournament`, `refId`: tournament id).\n\n' +
      'Whole-call errors: `404 TOURNAMENT_NOT_FOUND`, `403 NOT_ORGANIZER`, `409 TOURNAMENT_CLOSED` ' +
      '(status is not `DRAFT` or `REGISTRATION_OPEN`).\n\n' +
      'Per-group codes in `results[].error.code`: `GROUP_NOT_FOUND`, `ALREADY_REGISTERED` (the group ' +
      'already has a team in), `INVITATION_EXISTS` (one is pending), `TOURNAMENT_FULL`.',
  })
  @ApiResponse({
    status: 207,
    description: 'Per-group results',
    schema: {
      example: {
        data: {
          results: [
            {
              groupId: '665f1c2e8b3a4d0012a3b4c5',
              status: 'INVITED',
              invitationId: '6720a1b2c3d4e5f6a7b8c9d0',
            },
            {
              groupId: '665f1c2e8b3a4d0012a3b4c6',
              status: 'FAILED',
              error: { code: 'INVITATION_EXISTS' },
            },
          ],
        },
      },
    },
  })
  invite(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateTournamentInvitationsDto,
  ) {
    return this.invitationsService.invite(user._id.toString(), id, dto);
  }

  @Get('tournaments/:id/invitations')
  @ApiOperation({
    summary: "A tournament's invitations, newest first (organizer)",
    description:
      'Every invitation the tournament sent, with the invited group (`id`, `name`, `handle`, `logo`; ' +
      '`null` if the group was deleted). `teamId` is set once accepted. Omit `status` for all.',
  })
  @ApiQuery({ name: 'status', required: false, enum: INVITATION_LIST_STATUSES })
  listSent(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('status') status?: string,
  ) {
    return this.invitationsService.listSent(
      user._id.toString(),
      id,
      toStatus(status),
    );
  }

  @Get('groups/:groupId/tournament-invitations')
  @ApiOperation({
    summary: 'Tournament invitations a group received (group owner/admin)',
    description:
      'Newest first, with a tournament summary (`title`, `format`, `status`, `startDate`, ' +
      '`maxTeams`, `currentTeams`, `hostGroupName`). Pending invitations to tournaments that have ' +
      'started, finished, been cancelled or deleted become `expired` when this list is read.\n\n' +
      'Errors: `404 GROUP_NOT_FOUND`; `403 NOT_GROUP_ADMIN`.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: INVITATION_LIST_STATUSES,
    description: 'Defaults to `pending`.',
  })
  listReceived(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
    @Query('status') status?: string,
  ) {
    return this.invitationsService.listReceived(
      user._id.toString(),
      groupId,
      toStatus(status) ?? 'pending',
    );
  }

  @Post('tournament-invitations/:invitationId/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept and register the group’s team (group owner/admin)',
    description:
      'Registers the team exactly like `POST /tournaments/{id}/teams`, with `clubId` set to the invited ' +
      'group. `captainId` defaults to the caller.\n\n' +
      'Errors: `404 INVITATION_NOT_FOUND` (also when the caller is not an owner/admin of the invited ' +
      'group); `409 INVITATION_NOT_PENDING`; `409 TOURNAMENT_CLOSED` (registration not open — the ' +
      'invitation stays pending while the tournament can still reopen, and expires once a phase has ' +
      'started); `409 TOURNAMENT_FULL`; `409 ALREADY_REGISTERED`; `409` when the captain already has a ' +
      'team in this tournament.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: {
          id: '6720a1b2c3d4e5f6a7b8c9d0',
          status: 'ACCEPTED',
          tournamentId: '6720a1b2c3d4e5f6a7b8c9aa',
          team: {
            _id: '6720a1b2c3d4e5f6a7b8c9bb',
            name: 'Team Alpha',
            players: ['665f1a2b3c4d5e6f7a8b9c0d'],
            captainId: '665f1a2b3c4d5e6f7a8b9c0d',
            clubId: '665f1c2e8b3a4d0012a3b4c5',
            status: 'APPROVED',
          },
        },
      },
    },
  })
  accept(
    @CurrentUser() user: any,
    @Param('invitationId') invitationId: string,
    @Body() dto: AcceptTournamentInvitationDto,
  ) {
    return this.invitationsService.accept(
      user._id.toString(),
      invitationId,
      dto,
    );
  }

  @Post('tournament-invitations/:invitationId/decline')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Decline an invitation (group owner/admin)',
    description:
      'The organizer is notified. Errors: `404 INVITATION_NOT_FOUND`, `409 INVITATION_NOT_PENDING`.',
  })
  decline(
    @CurrentUser() user: any,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitationsService.decline(user._id.toString(), invitationId);
  }

  @Delete('tournament-invitations/:invitationId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoke a pending invitation (organizer)',
    description:
      'Errors: `404 INVITATION_NOT_FOUND`, `403 NOT_ORGANIZER`, `409 INVITATION_NOT_PENDING`.',
  })
  async revoke(
    @CurrentUser() user: any,
    @Param('invitationId') invitationId: string,
  ) {
    await this.invitationsService.revoke(user._id.toString(), invitationId);
  }
}
