import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsIn,
  IsArray,
  Matches,
  MinLength,
  MaxLength,
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
    example:
      'Be on time — arrive 15-30 minutes before kick-off\nNo alcohol before the match',
    required: false,
    description:
      'Free-form rules text. Newlines are preserved verbatim — render with ' +
      'white-space: pre-line or split on \\n.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  rules?: string;

  @ApiProperty({ example: 'Thailand', required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ example: 'Bangkok', required: false })
  @IsOptional()
  @IsString()
  city?: string;
}
