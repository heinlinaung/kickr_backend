import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import { DEVICE_PLATFORMS } from '../../users/schemas/user.schema';

/** Body for `POST /notifications/devices`. */
export class RegisterDeviceDto {
  @ApiProperty({
    example: 'fMEr...long-fcm-token',
    description:
      'The FCM registration token from the client SDK. Re-post it whenever ' +
      'the SDK rotates it — registering the same token twice is safe and ' +
      'simply refreshes it.',
  })
  @IsString()
  @MinLength(10)
  fcmToken: string;

  @ApiProperty({
    enum: DEVICE_PLATFORMS,
    example: 'android',
    description: 'Recorded for diagnostics; delivery does not branch on it.',
  })
  @IsIn([...DEVICE_PLATFORMS])
  platform: string;
}
