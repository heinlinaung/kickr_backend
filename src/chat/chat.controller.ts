import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChatService } from './chat.service';

@Controller('groups/:id/messages')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get()
  getHistory(@Param('id') groupId: string, @Query('limit') limit?: string) {
    return this.chatService.getHistory(groupId, limit ? parseInt(limit, 10) : 50);
  }
}
