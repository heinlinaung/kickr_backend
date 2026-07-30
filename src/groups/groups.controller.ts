import {
  Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AttachLocationDto } from './dto/attach-location.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { SetGroupRulesDto } from './dto/group-rules.dto';
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
  findOne(@Param('id') id: string) {
    return this.groupsService.findById(id);
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

  @Get(':id/qr')
  getQr(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.getQr(id, user._id.toString());
  }

  @Get(':id/rules')
  getRules(@Param('id') id: string) {
    return this.groupsService.getRules(id);
  }

  @Post(':id/rules')
  setRules(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: SetGroupRulesDto,
  ) {
    return this.groupsService.setRules(id, user._id.toString(), dto.rules);
  }

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
    return this.groupsService.detachLocation(id, user._id.toString(), locationId);
  }

  @Get(':id/members')
  listMembers(@Param('id') id: string) {
    return this.groupsService.listMembers(id);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') groupId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: any,
  ) {
    return this.groupsService.removeMember(groupId, user._id.toString(), targetUserId);
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
    const code = await this.groupsService.generateInviteCode(id, user._id.toString());
    return { inviteCode: code };
  }
}
