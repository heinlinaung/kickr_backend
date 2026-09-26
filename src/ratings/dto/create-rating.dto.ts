// src/ratings/dto/create-rating.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  MAX_RATING_DESCRIPTION,
  MAX_STARS,
  MIN_STARS,
  RATING_TARGETS,
} from '../schemas/rating.schema';

/**
 * Body for `POST /ratings` (spec §4.10).
 *
 * One endpoint for all three target kinds — the pair (targetType, targetId)
 * names what is being rated. Submitting again for the same target REPLACES
 * the caller's previous rating rather than adding a second one; eligibility
 * (membership / roster / shared finished event) is checked in the service,
 * which has the models.
 */
export class CreateRatingDto {
  @ApiProperty({ enum: RATING_TARGETS, example: 'event' })
  @IsIn(RATING_TARGETS as unknown as string[])
  targetType: string;

  @ApiProperty({
    example: '665f1a2b3c4d5e6f70819200',
    description: 'Id of the player (user), event, or group being rated.',
  })
  @IsMongoId()
  targetId: string;

  @ApiProperty({ minimum: MIN_STARS, maximum: MAX_STARS, example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_STARS)
  @Max(MAX_STARS)
  stars: number;

  @ApiPropertyOptional({
    maxLength: MAX_RATING_DESCRIPTION,
    example: 'Great pitch and well organized, kickoff ran a bit late.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RATING_DESCRIPTION)
  description?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      "Hide the rater's identity from other users. The rating still counts " +
      'as yours: it replaces your previous one and you can delete it.',
  })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}
