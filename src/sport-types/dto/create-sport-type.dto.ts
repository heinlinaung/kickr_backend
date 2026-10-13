// src/sport-types/dto/create-sport-type.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
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

export const normaliseSlugs = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? (value as unknown[]).map(slug) : value;

export class CreateSportTypeDto {
  @ApiProperty({
    example: 'tennis',
    description:
      'The value groups/events/users will store. Unique, lowercased. ' +
      'Immutable once created — it is the datum other documents carry.',
  })
  @Transform(normaliseSlug)
  @IsString()
  @Matches(SPORT_SLUG, { message: `value ${SPORT_SLUG_MESSAGE}` })
  value: string;

  @ApiProperty({
    type: [String],
    example: ['singles', 'doubles'],
    required: false,
    description:
      'Formats an EVENT of this sport may set as `subType`. Omit or send ' +
      '[] for a sport with no formats. Deduplicated.',
  })
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
