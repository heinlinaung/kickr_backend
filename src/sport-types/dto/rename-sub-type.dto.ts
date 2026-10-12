import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  normaliseSlug,
  SPORT_SLUG,
  SPORT_SLUG_MESSAGE,
} from './create-sport-type.dto';

/** Body of PATCH /sport-types/:value/sub-types/:subType — the new name. */
export class RenameSubTypeDto {
  @ApiProperty({
    example: 'eleven-a-side',
    description:
      'The new name. Events and event templates storing the old one are ' +
      'moved to it.',
  })
  @Transform(normaliseSlug)
  @IsString()
  @Matches(SPORT_SLUG, { message: `subType ${SPORT_SLUG_MESSAGE}` })
  subType: string;
}
