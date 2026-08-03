import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  AdminKeyGuard,
  ADMIN_KEY_HEADER,
} from '../common/guards/admin-key.guard';
import { AdminService } from './admin.service';
import { AddUsersDto } from './dto/add-users.dto';

/**
 * Server-to-server support endpoints. Authenticated by the ADMIN_KEY shared
 * secret, NOT by a user JWT — there is no acting user here.
 */
@ApiTags('Admin')
@ApiHeader({
  name: ADMIN_KEY_HEADER,
  description: 'Shared admin secret (ADMIN_KEY)',
  required: true,
})
@Controller('admin')
@UseGuards(AdminKeyGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** Force-add users to a group as approved members, skipping owner approval. */
  @Post('groups/:groupId/members')
  addGroupMembers(@Param('groupId') groupId: string, @Body() dto: AddUsersDto) {
    return this.adminService.addGroupMembers(groupId, dto.userIds);
  }

  /** Force-add users to an event, ignoring its lifecycle state. */
  @Post('events/:eventId/players')
  addEventPlayers(@Param('eventId') eventId: string, @Body() dto: AddUsersDto) {
    return this.adminService.addEventPlayers(eventId, dto.userIds);
  }
}
