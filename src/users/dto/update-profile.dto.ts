import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  MinLength,
  IsArray,
  IsIn,
  IsDateString,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FOOTBALL_POSITIONS,
  PROFILE_VISIBILITY,
  SPORT_TYPES,
} from '../profile.constants';

class PrivacyDto {
  @ApiProperty({ enum: PROFILE_VISIBILITY, required: false })
  @IsOptional()
  @IsIn([...PROFILE_VISIBILITY])
  profileVisibility?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showStats?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showMatchHistory?: boolean;
}

export class UpdateProfileDto {
  @ApiProperty({ example: 'John Doe', minLength: 2, required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiProperty({ example: 'johndoe', minLength: 3, required: false })
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @ApiProperty({ example: 'Johnny', required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ example: '+66812345678', required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ example: 175, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  height?: number;

  @ApiProperty({ example: 70, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weight?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  biography?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false, example: '1995-06-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn([...SPORT_TYPES], { each: true })
  sports?: string[];

  @ApiProperty({ required: false, enum: SPORT_TYPES })
  @IsOptional()
  @IsIn([...SPORT_TYPES])
  preferredSport?: string;

  @ApiProperty({ required: false, enum: FOOTBALL_POSITIONS })
  @IsOptional()
  @IsIn([...FOOTBALL_POSITIONS])
  footballPosition?: string;

  @ApiProperty({ required: false, type: PrivacyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyDto)
  privacy?: PrivacyDto;
}
