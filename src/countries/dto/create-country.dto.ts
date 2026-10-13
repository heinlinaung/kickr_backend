// src/countries/dto/create-country.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  normalisePlaceId,
  PLACE_ID,
  PLACE_ID_MESSAGE,
  RegionDto,
  trimString,
} from './region.dto';

export class CreateCountryDto {
  @ApiProperty({
    example: 'myanmar',
    required: false,
    description:
      'The value groups/users store as `country`. Omit to derive it from ' +
      '`name` (lowercased). Unique. Immutable once created.',
  })
  @IsOptional()
  @Transform(normalisePlaceId)
  @IsString()
  @Matches(PLACE_ID, { message: `id ${PLACE_ID_MESSAGE}` })
  id?: string;

  @ApiProperty({ example: 'Myanmar' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 1,
    required: false,
    description: 'Display position. Omit to append after the last country.',
  })
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
    description: 'In display order. Region ids must be unique.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RegionDto)
  regions?: RegionDto[];
}
