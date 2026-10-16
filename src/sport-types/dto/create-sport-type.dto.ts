// src/sport-types/dto/create-sport-type.dto.ts
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Sport values and subTypes are stored verbatim on groups, events and users,
 * so they are normalised here (trimmed, lowercased) and kept to a slug shape —
 * 'Football ' and 'football' must never become two different sports.
 */
export const SPORT_SLUG = /^[a-z0-9][a-z0-9_-]*$/;
export const SPORT_SLUG_MESSAGE =
  'must be a lowercase slug (letters, digits, - or _)';

const slug = (v: unknown): unknown =>
  typeof v === 'string' ? v.trim().toLowerCase() : v;

export const normaliseSlug = ({ value }: { value: unknown }): unknown =>
  slug(value);

export const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const normaliseSlugs = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? (value as unknown[]).map(slug) : value;

export class CreateSportTypeDto {
  @ApiProperty({
    example: 'tennis',
    description:
      "The sport's ID — the value groups/events/users will store. Unique, " +
      'lowercased. Immutable once created; rename via PATCH `name` instead.',
  })
  @Transform(normaliseSlug)
  @IsString()
  @Matches(SPORT_SLUG, { message: `value ${SPORT_SLUG_MESSAGE}` })
  value: string;

  @ApiProperty({
    example: 'Tennis',
    required: false,
    description:
      'Display label. Unique (case-insensitive). Defaults to `value`.',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  // Formats an EVENT of this sport may set as `subType`. Hidden from Swagger:
  // sub-types are managed through the /sport-types/:value/sub-types endpoints.
  // Still accepted here (deduplicated) for the seed script and old clients.
  @ApiHideProperty()
  @IsOptional()
  @Transform(normaliseSlugs)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(SPORT_SLUG, {
    each: true,
    message: `each subType ${SPORT_SLUG_MESSAGE}`,
  })
  subTypes?: string[];

  @ApiProperty({
    type: [String],
    example: ['goalkeeper', 'defender', 'midfielder', 'forward'],
    required: false,
    description:
      'Roles a player can take in this sport, in display order. Omit or ' +
      'send [] for a sport without positions. Deduplicated.',
  })
  @IsOptional()
  @Transform(normaliseSlugs)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(SPORT_SLUG, {
    each: true,
    message: `each playerRole ${SPORT_SLUG_MESSAGE}`,
  })
  playerRoles?: string[];

  @ApiProperty({
    example: 6,
    required: false,
    description:
      'Display position. Omit to append after the current last sport.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({
    example: true,
    required: false,
    description:
      'Whether events of this sport are played as a match — drives the ' +
      'match timeline on the event detail screen. Defaults to true.',
  })
  @IsOptional()
  @IsBoolean()
  matchProvided?: boolean;
}
