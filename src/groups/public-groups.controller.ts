// src/groups/public-groups.controller.ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GroupsService } from './groups.service';

/**
 * The PUBLIC group read (2026-10-14): group detail needs no account and no
 * membership — a shared link must open for anyone, private groups included.
 * Auth is OPTIONAL rather than absent so a signed-in caller still gets
 * their flags (`userRole`, `memberStatus`, `isCashier`).
 *
 * Its own controller because GroupsController is class-guarded; registered
 * AFTER it in the module so `search` and the other static routes keep
 * matching before this `:id`.
 */
@ApiTags('Groups')
@Controller('groups')
@UseGuards(OptionalJwtAuthGuard)
export class PublicGroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Group detail (public)',
    description:
      'PUBLIC — no token required, and the full document is returned ' +
      'whether the group is private or not. With a valid token the response ' +
      "also carries the caller's `userRole`, `memberStatus` and `isCashier`;" +
      ' anonymous callers get null/false for those.',
  })
  @ApiResponse({ status: 404, description: 'No such group' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.findById(id, user?._id?.toString());
  }
}
