import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List your notifications (paginated)',
    description:
      'Returns a page: `{ items, nextCursor, hasMore }`. Newest first. ' +
      '⚠️ CHANGED — this used to return a bare array, and used to float ' +
      'unread rows to the top. It now sorts by `createdAt` alone, because ' +
      '`isRead` changes: marking something read mid-pagination would move it ' +
      'between pages and make the cursor skip or repeat a row. Every row ' +
      'still carries `isRead`, so badge or filter on it client-side. Pass ' +
      '`nextCursor` back verbatim for the next page; a null `nextCursor` ' +
      'means the end.',
  })
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
  list(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.notificationsService.findForUser(
      user._id.toString(),
      limit === undefined ? undefined : Number(limit),
      cursor,
    );
  }

  @Post('devices')
  @ApiOperation({
    summary: 'Register this device for push',
    description:
      'Call after the client SDK returns an FCM token, and again whenever it ' +
      'rotates. Registering the same token twice is safe — it refreshes ' +
      'rather than duplicating. A token is also detached from any OTHER ' +
      'account that had it, so a shared or handed-over device never receives ' +
      "the previous user's notifications. A user may have several devices; " +
      'all of them receive push.',
  })
  registerDevice(@CurrentUser() user: any, @Body() dto: RegisterDeviceDto) {
    return this.notificationsService.registerDevice(
      user._id.toString(),
      dto.fcmToken,
      dto.platform,
    );
  }

  @Delete('devices/:fcmToken')
  @ApiOperation({
    summary: 'Deregister a device',
    description:
      'Call on logout. Without it push keeps arriving on a device the user ' +
      'has signed out of. Unknown tokens are a no-op rather than a 404 — the ' +
      'desired state is "not registered" either way.',
  })
  unregisterDevice(
    @Param('fcmToken') fcmToken: string,
    @CurrentUser() user: any,
  ) {
    return this.notificationsService.unregisterDevice(
      user._id.toString(),
      fcmToken,
    );
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllRead(user._id.toString());
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.notificationsService.markRead(id, user._id.toString());
  }
}
