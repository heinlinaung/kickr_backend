import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AttachLocationDto } from './dto/attach-location.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { multerMemoryImageOptions } from '../common/upload/multer-memory.config';

@ApiTags('Groups')
@ApiBearerAuth()
@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Get()
  getMyGroups(@CurrentUser() user: any) {
    return this.groupsService.getMyGroups(user._id.toString());
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(user._id.toString(), dto);
  }

  // NOTE: must stay above the ":id" wildcard route below, otherwise Nest
  // resolves "search" as an id and this route becomes unreachable.
  @Get('search')
  search(@Query('q') q: string) {
    return this.groupsService.search(q ?? '');
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.findById(id, user._id.toString());
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(id, user._id.toString(), dto);
  }

  @Post(':id/wallpaper')
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  uploadWallpaper(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.groupsService.updateWallpaper(id, user._id.toString(), file);
  }

  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  uploadLogo(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.groupsService.updateLogo(id, user._id.toString(), file);
  }

  // Any authenticated user — no role check (see GroupsService.getQr).
  @Get(':id/qr')
  getQr(@Param('id') id: string) {
    return this.groupsService.getQr(id);
  }

  // Group rules have no dedicated routes: they are just the `rules` field on
  // POST /groups, PATCH /groups/:id and GET /groups/:id.

  @Get(':id/locations')
  listLocations(@Param('id') id: string) {
    return this.groupsService.listLocations(id);
  }

  @Post(':id/locations')
  attachLocation(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: AttachLocationDto,
  ) {
    return this.groupsService.attachLocation(id, user._id.toString(), dto);
  }

  @Delete(':id/locations/:locationId')
  detachLocation(
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: any,
  ) {
    return this.groupsService.detachLocation(
      id,
      user._id.toString(),
      locationId,
    );
  }

  // Self-service: any member (admin/captain/member) may leave. The owner is
  // refused — see GroupsService.leave.
  @Post(':id/leave')
  leave(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.leave(id, user._id.toString());
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a group and everything it owns (OWNER only)',
    description:
      'Owner only — NOT owner-or-admin, unlike the other management routes. ' +
      'An admin can be appointed and removed, so destroying the group is a ' +
      'different order of trust from editing it. ' +
      'IRREVERSIBLE and a FULL CASCADE: the group, its members, its events ' +
      '(with every event\'s players, fixtures, teams, chats, likes and ' +
      'payments), its chat messages, its tournaments and its locations are ' +
      'all hard-deleted. There is no archive and nothing to undo. ' +
      'The response reports how many rows of each kind went, so the caller ' +
      'can confirm the blast radius. ' +
      'NOTE: an event outside this group that adopted one of its venues will ' +
      'keep a locationId that no longer resolves — the accepted cost of ' +
      'deleting locations rather than orphaning them.',
  })
  @ApiResponse({
    status: 200,
    description: 'Deleted, with per-collection counts',
    schema: {
      example: {
        data: {
          message: 'Group deleted successfully',
          deleted: {
            events: 3,
            members: 27,
            messages: 412,
            tournaments: 0,
            locations: 2,
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Caller is not the group owner' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.remove(id, user._id.toString());
  }

  @Get(':id/members')
  @ApiOperation({
    summary: "The group's approved members",
    description:
      'A private group returns 403 unless the caller is an approved member — ' +
      'a pending join request is not enough. Public groups are open to any ' +
      'authenticated caller. Member email addresses are never returned.',
  })
  listMembers(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.listMembers(id, user._id.toString());
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') groupId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: any,
  ) {
    return this.groupsService.removeMember(
      groupId,
      user._id.toString(),
      targetUserId,
    );
  }

  @Patch(':id/members/:userId/role')
  updateMemberRole(
    @Param('id') groupId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.groupsService.updateMemberRole(
      groupId,
      user._id.toString(),
      targetUserId,
      dto,
    );
  }

  @Get(':id/invite-code')
  async getInviteCode(@Param('id') id: string, @CurrentUser() user: any) {
    const code = await this.groupsService.generateInviteCode(
      id,
      user._id.toString(),
    );
    return { inviteCode: code };
  }
}
