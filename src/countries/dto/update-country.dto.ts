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
import { RegionDto, trimString } from './region.dto';

// `id` is intentionally absent: groups and users store it as `country`, so a
// rename would strand them. Change `name` instead.
export class UpdateCountryDto {
  @ApiProperty({ example: 'Myanmar', required: false })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: 2, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({
    type: [RegionDto],
    required: false,
    description:
      'Replaces the whole regions list (and its order). A region still used ' +
      'as `city` by a group or user in this country cannot be dropped.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RegionDto)
  regions?: RegionDto[];
}
