// src/countries/dto/region.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Country and region ids are stored verbatim as `country` / `city` on groups
 * and users, which are lowercased on write. So ids are normalised the same way
 * (trimmed, lowercased, inner whitespace collapsed) and kept to a simple
 * shape. Single spaces are allowed because existing values use them, e.g.
 * 'chiang mai'.
 */
export const PLACE_ID = /^[a-z0-9]+(?:[ _-][a-z0-9]+)*$/;
export const PLACE_ID_MESSAGE =
  'must be lowercase letters/digits, separated by single spaces, - or _';

export const toPlaceId = (v: string): string =>
  v.trim().toLowerCase().replace(/\s+/g, ' ');

export const normalisePlaceId = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? toPlaceId(value) : value;

export const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** One region in a request body. Also the body of POST /countries/:id/regions. */
export class RegionDto {
  @ApiProperty({
    example: 'chiang mai',
    required: false,
    description:
      'The value groups/users store as `city`. Omit to derive it from ' +
      '`name` (lowercased). Immutable once created.',
  })
  @IsOptional()
  @Transform(normalisePlaceId)
  @IsString()
  @Matches(PLACE_ID, { message: `id ${PLACE_ID_MESSAGE}` })
  id?: string;

  @ApiProperty({ example: 'Chiang Mai' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

/** Body of PATCH /countries/:id/regions/:regionId — only the name changes. */
export class UpdateRegionDto {
  @ApiProperty({ example: 'Chiang Mai' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
