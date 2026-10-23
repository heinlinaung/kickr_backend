import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsMongoId,
  ArrayMaxSize,
  Matches,
  MinLength,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { JerseyColorDto } from './jersey-color.dto';

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
    description:
      'One of the values from GET /configuration `sportTypes` — checked against that ' +
      'collection in the service, not a hardcoded list here. Events created ' +
      "under the group always inherit the group's sportType.",
  })
  @IsOptional()
  @IsString()
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

  @ApiProperty({ example: 'thailand', required: false })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  country?: string;

  @ApiProperty({ example: 'bangkok', required: false })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  city?: string;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiProperty({
    example: false,
    required: false,
    default: false,
    description:
      'When true, any approved member can read the individual expense ' +
      'entries (GET /events/:eventId/expenses). Default false: members see ' +
      'only per-category totals in GET /events/:eventId/finance.',
  })
  @IsOptional()
  @IsBoolean()
  showExpenseDetailsToMembers?: boolean;

  @ApiProperty({ example: 22, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;

  @ApiProperty({
    required: false,
    type: [JerseyColorDto],
    example: [
      { top: 'white', pant: 'white' },
      { top: 'red', pant: 'black' },
    ],
    description:
      "The team's kits (max 5) — one entry per jersey set, e.g. home and away.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => JerseyColorDto)
  jerseyColors?: JerseyColorDto[];
}
