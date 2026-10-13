// src/sport-types/dto/reorder-sub-types.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  normaliseSlugs,
  SPORT_SLUG,
  SPORT_SLUG_MESSAGE,
} from './create-sport-type.dto';

/** Body of PUT /sport-types/:value/sub-types/order — the new display order. */
export class ReorderSubTypesDto {
  @ApiProperty({
    type: [String],
    example: ['stadium', 'futsal'],
    description:
      "Every one of the sport's current subTypes, exactly once, in the new " +
      'display order. Nothing can be added, dropped or renamed here.',
  })
  @Transform(normaliseSlugs)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(SPORT_SLUG, {
    each: true,
    message: `each subType ${SPORT_SLUG_MESSAGE}`,
  })
  subTypes: string[];
}
