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
import { APP_VERSION, APP_VERSION_MESSAGE } from './create-app-config.dto';

// Every field optional at every level: a PATCH sends only what changes, and
// the service fills the rest from the current latest revision.

export class UpdateAppUpdatePlatformDto {
  @ApiProperty({ example: '1.0.2', required: false })
  @IsOptional()
  @Matches(APP_VERSION, { message: `latestVersion ${APP_VERSION_MESSAGE}` })
  latestVersion?: string;

  @ApiProperty({ example: '1.0.0', required: false })
  @IsOptional()
  @Matches(APP_VERSION, { message: `minimumVersion ${APP_VERSION_MESSAGE}` })
  minimumVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  upgradeTitle?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  upgradeDescription?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  forceUpdate?: boolean;
}

export class UpdateMajorUpdatePlatformDto {
  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '2.0.0', required: false })
  @IsOptional()
  @Matches(APP_VERSION, { message: `version ${APP_VERSION_MESSAGE}` })
  version?: string;
}

export class UpdateAppUpdateDto {
  @ApiProperty({ type: UpdateAppUpdatePlatformDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAppUpdatePlatformDto)
  ios?: UpdateAppUpdatePlatformDto;

  @ApiProperty({ type: UpdateAppUpdatePlatformDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAppUpdatePlatformDto)
  android?: UpdateAppUpdatePlatformDto;
}

export class UpdateMajorUpdateDto {
  @ApiProperty({ type: UpdateMajorUpdatePlatformDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateMajorUpdatePlatformDto)
  ios?: UpdateMajorUpdatePlatformDto;

  @ApiProperty({ type: UpdateMajorUpdatePlatformDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateMajorUpdatePlatformDto)
  android?: UpdateMajorUpdatePlatformDto;
}

export class UpdateAppConfigDto {
  @ApiProperty({ type: UpdateAppUpdateDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAppUpdateDto)
  appUpdate?: UpdateAppUpdateDto;

  @ApiProperty({ type: UpdateMajorUpdateDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateMajorUpdateDto)
  majorUpdate?: UpdateMajorUpdateDto;
}
