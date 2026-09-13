// src/photos/group-photos.controller.ts
import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { multerMemoryImageOptions } from '../common/upload/multer-memory.config';
import { PhotosService } from './photos.service';
import { MAX_PHOTOS_PER_TARGET } from './schemas/photo.schema';

@ApiTags('Photos')
@ApiBearerAuth()
@Controller('groups/:id/photos')
@UseGuards(JwtAuthGuard)
export class GroupPhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get()
  @ApiOperation({
    summary: "A group's photo gallery",
    description:
      "Every photo uploaded to the group, PLUS every photo uploaded to the " +
      "group's events — so event photos are reachable from one place without " +
      'walking the event list. Newest first. ' +
      'Members only: a non-member gets 403, and a pending join request counts ' +
      'as a non-member, the same gate as the member list and chat history.',
  })
  @ApiResponse({ status: 403, description: 'Caller is not a group member' })
  async list(@Param('id') groupId: string, @CurrentUser() user: any) {
    // Read gate is MEMBERSHIP, not owner/admin: the point of a gallery is that
    // everyone in the group can look at it. Only uploading is restricted.
    const role = await this.photos.memberRole(groupId, user._id.toString());
    if (!role) throw new ForbiddenException('Not a member of this group');

    return this.photos.listForGroup(groupId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  @ApiOperation({
    summary: 'Add a photo to the group gallery (owner/admin only)',
    description:
      'Multipart, field name `file`. JPEG/PNG/WebP, 10MB max. ' +
      `At most ${MAX_PHOTOS_PER_TARGET} photos per group — the cap counts the ` +
      "group's OWN photos, not its events', so an event gallery cannot " +
      'exhaust the group allowance. Delete one to make room. ' +
      'Owner/admin only, matching who may upload an event photo.',
  })
  @ApiResponse({ status: 403, description: 'Caller is not an owner or admin' })
  @ApiResponse({ status: 400, description: 'No file, wrong type, or cap reached' })
  async add(
    @Param('id') groupId: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    if (!(await this.photos.isGroupManager(groupId, user._id.toString()))) {
      throw new ForbiddenException('Only the group owner or admin can do this');
    }

    // groupId stays null: for a GROUP photo, targetId already identifies the
    // group. Setting both would double-count it in the gallery's $or.
    return this.photos.add('group', groupId, user._id.toString(), file, null);
  }

  @Delete(':fileId')
  @ApiOperation({
    summary: 'Remove a photo from the group gallery (owner/admin only)',
    description:
      "Removes one of the GROUP's own photos. An event's photo is not " +
      'reachable here even though it appears in this gallery — delete it via ' +
      'DELETE /events/:id/photos/:fileId, so the event that owns it stays the ' +
      'thing that governs it.',
  })
  @ApiResponse({ status: 403, description: 'Caller is not an owner or admin' })
  @ApiResponse({ status: 404, description: 'No such photo on this group' })
  async remove(
    @Param('id') groupId: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: any,
  ) {
    if (!(await this.photos.isGroupManager(groupId, user._id.toString()))) {
      throw new ForbiddenException('Only the group owner or admin can do this');
    }

    // Scoped to targetType 'group', so this route cannot delete an event's
    // photo by fileId even though the gallery read surfaces both.
    return this.photos.remove('group', groupId, fileId);
  }
}
