import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
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
  list(@CurrentUser() user: any) {
    return this.notificationsService.findForUser(user._id.toString());
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
