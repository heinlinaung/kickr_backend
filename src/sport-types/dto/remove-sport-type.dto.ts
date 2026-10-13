// src/sport-types/dto/remove-sport-type.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  normaliseSlug,
  SPORT_SLUG,
  SPORT_SLUG_MESSAGE,
} from './create-sport-type.dto';

/** Query of DELETE /sport-types/:value. */
export class RemoveSportTypeQueryDto {
  @ApiProperty({
    example: 'football',
    required: false,
    description:
      'Move every group, event, template and user profile storing the ' +
      'deleted sport to this one first. Omit to refuse (409) while in use.',
  })
  @IsOptional()
  @Transform(normaliseSlug)
  @IsString()
  @Matches(SPORT_SLUG, { message: `replaceWith ${SPORT_SLUG_MESSAGE}` })
  replaceWith?: string;
}
