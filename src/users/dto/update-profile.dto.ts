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
  IsMongoId,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FOOTBALL_POSITIONS,
  PROFILE_VISIBILITY,
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

  @ApiProperty({
    required: false,
    type: [String],
    example: ['football', 'badminton'],
    description:
      'Values from GET /sport-types — checked against that collection in ' +
      'the service, not a hardcoded list here, same as group/event ' +
      'sportType.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sports?: string[];

  @ApiProperty({
    required: false,
    example: 'football',
    description:
      'One of the values from GET /sport-types — checked against that ' +
      'collection in the service.',
  })
  @IsOptional()
  @IsString()
  preferredSport?: string;

  @ApiProperty({ required: false, enum: FOOTBALL_POSITIONS })
  @IsOptional()
  @IsIn([...FOOTBALL_POSITIONS])
  footballPosition?: string;

  @ApiProperty({
    required: false,
    example: '68b9c1aa22bb33cc44dd0003',
    description:
      'The _id of a club from GET /global-football-teams. Validated against ' +
      'that collection, so an unknown id is a 400 rather than a silently ' +
      'null `favouriteTeam` on every later read. Send null to clear it.',
  })
  @IsOptional()
  @IsMongoId()
  favouriteTeamId?: string | null;

  @ApiProperty({ required: false, type: PrivacyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyDto)
  privacy?: PrivacyDto;
}
