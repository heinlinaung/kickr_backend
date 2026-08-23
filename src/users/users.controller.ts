import {
  Controller,
  Get,
  Patch,
  Post,
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
  ApiQuery,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { multerMemoryImageOptions } from '../common/upload/multer-memory.config';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.usersService.findById(user._id.toString());
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user._id.toString(), dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  uploadAvatar(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.usersService.updateAvatar(user._id.toString(), file);
  }

  @Get('me/qr')
  getQr(@CurrentUser() user: any) {
    return this.usersService.getQr(user._id.toString());
  }

  /**
   * Declared BEFORE `@Get(':id/profile')` — Nest matches in declaration order,
   * and a route added later under `:id` would shadow this one.
   */
  @Get('search')
  @ApiOperation({
    summary: 'Find users by name, username or exact email',
    description:
      'Case-insensitive substring match on name, username and displayName. ' +
      'An email is matched only when the query IS a full address — partial ' +
      'email matching would let anyone enumerate registered addresses. The ' +
      'email itself is never returned. Users with profileVisibility ' +
      "'private' are excluded, since their profile 404s anyway. " +
      'Returns a page: `{ items, nextCursor, hasMore }`. Sorted by _id — ' +
      'there is no relevance ranking. An empty query returns an empty page.',
  })
  @ApiQuery({ name: 'q', required: true, example: 'hein' })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Page size, 1-50. Defaults to 20.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description:
      'Opaque pagination cursor. Pass `nextCursor` from the previous ' +
      'response verbatim; omit for the first page. Invalid values give 400.',
  })
  search(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.usersService.search(
      q ?? '',
      limit === undefined ? undefined : Number(limit),
      cursor,
    );
  }

  @Get(':id/profile')
  getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }
}
