// src/sport-types/dto/update-sport-type.dto.ts
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
import {
  normaliseSlugs,
  SPORT_SLUG,
  SPORT_SLUG_MESSAGE,
} from './create-sport-type.dto';

// `value` is intentionally absent: renaming a sport would strand every group,
// event and user already storing the old string. Delete and re-create instead.
export class UpdateSportTypeDto {
  @ApiProperty({
    type: [String],
    example: ['futsal', 'stadium'],
    required: false,
    description:
      'Replaces the whole subTypes list. A subType still used by an event ' +
      'or event template cannot be dropped.',
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

  @ApiProperty({ example: 2, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({
    example: true,
    required: false,
    description:
      'Whether events of this sport are played as a match — drives the ' +
      'match timeline on the event detail screen.',
  })
  @IsOptional()
  @IsBoolean()
  matchProvided?: boolean;
}
