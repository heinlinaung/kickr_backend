import {
  Controller, Post, Get, Patch, Delete, Body, Param, UseGuards,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { multerDiskOptions } from '../common/upload/multer.config';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(user._id.toString(), dto);
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
  @UseInterceptors(FileInterceptor('file', multerDiskOptions('groups')))
  uploadWallpaper(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.groupsService.updateWallpaper(id, user._id.toString(), file.filename);
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

  @Get(':id/invite-code')
  async getInviteCode(@Param('id') id: string, @CurrentUser() user: any) {
    const code = await this.groupsService.generateInviteCode(id, user._id.toString());
    return { inviteCode: code };
  }
}
