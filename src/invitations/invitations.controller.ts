import { Controller, Post, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InvitationsService } from './invitations.service';
import { RespondInvitationDto } from './dto/respond-invitation.dto';

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private invitationsService: InvitationsService) {}

  @Post('groups/:id/invitations')
  requestToJoin(@Param('id') groupId: string, @CurrentUser() user: any) {
    return this.invitationsService.requestToJoin(groupId, user._id.toString());
  }

  @Get('groups/:id/invitations')
  listPending(@Param('id') groupId: string, @CurrentUser() user: any) {
    return this.invitationsService.listPending(groupId, user._id.toString());
  }

  @Patch('groups/:id/invitations/:invId')
  respond(
    @Param('id') groupId: string,
    @Param('invId') invId: string,
    @CurrentUser() user: any,
    @Body() dto: RespondInvitationDto,
  ) {
    return this.invitationsService.respond(groupId, invId, user._id.toString(), dto);
  }

  @Post('groups/join-by-code')
  joinByCode(@Body('code') code: string, @CurrentUser() user: any) {
    return this.invitationsService.joinByCode(code, user._id.toString());
  }
}
