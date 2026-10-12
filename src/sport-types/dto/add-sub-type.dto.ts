// src/sport-types/dto/add-sub-type.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  normaliseSlug,
  SPORT_SLUG,
  SPORT_SLUG_MESSAGE,
} from './create-sport-type.dto';

export class AddSubTypeDto {
  @ApiProperty({ example: 'beach' })
  @Transform(normaliseSlug)
  @IsString()
  @Matches(SPORT_SLUG, { message: `subType ${SPORT_SLUG_MESSAGE}` })
  subType: string;
}
