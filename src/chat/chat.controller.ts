import { Controller, Get, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { GroupsService } from '../groups/groups.service';

@Controller('groups/:id/messages')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private chatService: ChatService,
    private groupsService: GroupsService,
  ) {}

  @Get()
  async getHistory(
    @Param('id') groupId: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: any,
  ) {
    const role = await this.groupsService.getMemberRole(groupId, user._id.toString());
    if (!role) throw new ForbiddenException('Not a member of this group');
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : 50;
    return this.chatService.getHistory(groupId, parsedLimit);
  }
}
