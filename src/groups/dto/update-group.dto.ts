import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsIn,
  IsArray,
  ArrayMaxSize,
  Matches,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateGroupDto {
  @ApiProperty({ example: 'Bangkok FC Updated', minLength: 2, required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiProperty({ example: 'Updated description', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 30, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;

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

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiProperty({
    example: ['Be on time', 'No slide tackles'],
    required: false,
    type: [String],
    description: 'max 3 rules',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  teamRules?: string[];
}
