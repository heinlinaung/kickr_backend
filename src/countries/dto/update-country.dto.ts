// src/countries/dto/update-country.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalisePlaceId, RegionDto, trimString } from './region.dto';

export class UpdateCountryDto {
  // Accepted so a client can send back the row it read, but it must equal the
  // path id: groups and users store it as `country`, so a rename would strand
  // them. Change `name` instead.
  @ApiProperty({
    example: 'myanmar',
    required: false,
    description: 'Must equal the path id. Ids cannot change.',
  })
  @IsOptional()
  @Transform(normalisePlaceId)
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Myanmar', required: false })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({
    type: [RegionDto],
    required: false,
    example: [
      { id: 'yangon', name: 'Yangon' },
      { id: 'mandalay', name: 'Mandalay' },
    ],
    description:
      'Replaces the whole regions list (and its order). Send existing ' +
      'regions with their `id` to keep them; an omitted `id` is derived ' +
      'from `name` (lowercased). Region ids must be unique. A region still ' +
      'used as `city` by a group or user in this country cannot be dropped.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RegionDto)
  regions?: RegionDto[];
}
