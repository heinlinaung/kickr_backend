import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** '1.0.1', '2.3', '10.0.0.4' — dotted numbers, so clients can compare them. */
export const APP_VERSION = /^\d+(\.\d+){0,3}$/;
export const APP_VERSION_MESSAGE = 'must be a dotted version like 1.0.1';

export class AppUpdatePlatformDto {
  @ApiProperty({ example: '1.0.1' })
  @Matches(APP_VERSION, { message: `latestVersion ${APP_VERSION_MESSAGE}` })
  latestVersion: string;

  @ApiProperty({
    example: '1.0.0',
    description: 'Builds below this are too old to keep running',
  })
  @Matches(APP_VERSION, { message: `minimumVersion ${APP_VERSION_MESSAGE}` })
  minimumVersion: string;

  @ApiProperty({ example: 'A new version is available' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  upgradeTitle: string;

  @ApiProperty({
    example:
      'Please update the app to enjoy the latest features and improvements.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  upgradeDescription: string;

  @ApiProperty({ example: false, required: false, default: false })
  @IsOptional()
  @IsBoolean()
  forceUpdate?: boolean;
}

export class MajorUpdatePlatformDto {
  @ApiProperty({ example: true, required: false, default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ example: 'Major Update Available' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({
    example:
      "We've made major improvements to the app. Please update to the latest version.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiProperty({ example: '1.0.0' })
  @Matches(APP_VERSION, { message: `version ${APP_VERSION_MESSAGE}` })
  version: string;
}

export class AppUpdateDto {
  @ApiProperty({ type: AppUpdatePlatformDto })
  @ValidateNested()
  @Type(() => AppUpdatePlatformDto)
  ios: AppUpdatePlatformDto;

  @ApiProperty({ type: AppUpdatePlatformDto })
  @ValidateNested()
  @Type(() => AppUpdatePlatformDto)
  android: AppUpdatePlatformDto;
}

export class MajorUpdateDto {
  @ApiProperty({ type: MajorUpdatePlatformDto })
  @ValidateNested()
  @Type(() => MajorUpdatePlatformDto)
  ios: MajorUpdatePlatformDto;

  @ApiProperty({ type: MajorUpdatePlatformDto })
  @ValidateNested()
  @Type(() => MajorUpdatePlatformDto)
  android: MajorUpdatePlatformDto;
}

export class FeaturesDto {
  @ApiProperty({ example: true, required: false, default: false })
  @IsOptional()
  @IsBoolean()
  tournament?: boolean;

  @ApiProperty({ example: false, required: false, default: false })
  @IsOptional()
  @IsBoolean()
  groupChallenge?: boolean;
}

/** A complete config. Saving it makes it the new latest revision. */
export class CreateAppConfigDto {
  @ApiProperty({ type: AppUpdateDto })
  @ValidateNested()
  @Type(() => AppUpdateDto)
  appUpdate: AppUpdateDto;

  @ApiProperty({ type: MajorUpdateDto })
  @ValidateNested()
  @Type(() => MajorUpdateDto)
  majorUpdate: MajorUpdateDto;

  @ApiProperty({
    type: FeaturesDto,
    required: false,
    description: 'Feature switches; any left out are off',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeaturesDto)
  features?: FeaturesDto;
}
