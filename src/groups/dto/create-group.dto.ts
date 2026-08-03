import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsIn,
  IsArray,
  IsMongoId,
  ArrayMaxSize,
  Matches,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGroupDto {
  @ApiProperty({ example: 'Bangkok FC', minLength: 2 })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    example: 'A group for Bangkok football players',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'football',
    required: false,
    enum: ['football', 'futsal', 'padel', 'basketball'],
  })
  @IsOptional()
  @IsIn(['football', 'futsal', 'padel', 'basketball'])
  sportType?: string;

  @ApiProperty({ example: 'bangkok-fc', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_.-]+$/, {
    message: 'handle must be lowercase alphanumeric, dot, dash or underscore',
  })
  handle?: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'existing Location ids owned by the caller (max 5)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsMongoId({ each: true })
  locationIds?: string[];

  @ApiProperty({
    example: [
      'Be on time — arrive 15-30 minutes before kick-off',
      'No alcohol before the match\n(drink afterwards if you like)',
    ],
    required: false,
    type: [String],
    description:
      'Team rules. No count or length limit; newlines within a rule are preserved.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rules?: string[];

  @ApiProperty({ example: 'Thailand', required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ example: 'Bangkok', required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiProperty({ example: 22, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;
}
