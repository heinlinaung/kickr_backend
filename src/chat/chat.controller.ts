import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SendMessageDto } from './dto/send-message.dto';
import { GroupsService } from '../groups/groups.service';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('groups/:id/messages')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private chatService: ChatService,
    private groupsService: GroupsService,
    private chatGateway: ChatGateway,
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

  @Post()
  @ApiOperation({
    summary: 'Send a message to a group',
    description:
      'Persists the message and broadcasts it to the group room over ' +
      'socket.io as a `newMessage` event — the SAME event the socket path ' +
      'emits, so a client cannot tell which door a message came through. ' +
      'Members only; a non-member gets 403 and a pending join request counts ' +
      'as a non-member. The response carries the stored message with the ' +
      'sender populated (name, profileImage), matching the shape returned by ' +
      'GET, so a sent message renders identically to a historical one. ' +
      'Text is trimmed and must not be blank; 2000 characters max.',
  })
  @ApiResponse({ status: 403, description: 'Caller is not a group member' })
  @ApiResponse({ status: 400, description: 'Blank or over-long text' })
  async send(
    @Param('id') groupId: string,
    @CurrentUser() user: any,
    @Body() dto: SendMessageDto,
  ) {
    // Same gate as the history read and the socket handler: getMemberRole
    // returns null for a non-member AND for a pending request, so an
    // unapproved requester can neither read nor post.
    const role = await this.groupsService.getMemberRole(
      groupId,
      user._id.toString(),
    );
    if (!role) throw new ForbiddenException('Not a member of this group');

    const message = await this.chatService.createMessage(
      groupId,
      user._id.toString(),
      dto.text,
    );

    // Broadcast AFTER the write, and never before: emitting first would show
    // other members a message that might then fail to save. The gateway
    // swallows its own errors, so a socket problem cannot fail this request —
    // the message is stored either way and history will show it.
    this.chatGateway.broadcastMessage(groupId, message);

    return message;
  }
}
