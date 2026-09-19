// src/events/dto/create-event-template.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body for `POST /event-templates` (spec §4.5).
 *
 * Only `name` is required — a template supplies whichever defaults the
 * organizer wants pre-filled and leaves the rest for the create call.
 *
 * Mirrors `CreateEventDto` field-for-field (same names, same constraints), so
 * a client can reuse its event form to save a template. Not carried over:
 * `startTime`/`endTime` (instants of one concrete event), `templateId`
 * (a template cannot be made from a template), and `teamCount` (removed from
 * templates entirely — the event's own default applies).
 */
export class CreateEventTemplateDto {
  @ApiProperty({ example: 'Tuesday 5-a-side' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiProperty({ required: false, example: '665f1a2b3c4d5e6f7a8b9c0d' })
  @IsOptional()
  @IsMongoId()
  groupId?: string;

  @ApiProperty({ required: false, example: 'Friday Night Football' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiProperty({ required: false, example: 'Casual 11v11 match at the park' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    required: false,
    example: '2026-07-01T18:00:00.000Z',
    description:
      'Accepted so the template body matches the event-create body, and ' +
      'stored — but never filled into a created event: `date` is required ' +
      'on POST /events, so the caller always supplies the real one.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({ required: false, example: '507f1f77bcf86cd799439011' })
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @ApiProperty({ required: false, example: 22 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  maxPlayers?: number;

  @ApiProperty({
    required: false,
    example: 'football',
    description: 'One of the values from GET /sport-types.',
  })
  @IsOptional()
  // Validated against the `sporttypes` collection in the service, same as
  // event create — not a hardcoded list here.
  @IsString()
  sportType?: string;

  @ApiProperty({
    required: false,
    example: 'stadium',
    description:
      'Format of the event, e.g. a FOOTBALL event is `futsal` or `stadium`. ' +
      'Must be one of the `subTypes` the sportType lists on GET /sport-types.',
  })
  @IsOptional()
  @IsString()
  subType?: string;

  @ApiProperty({
    required: false,
    enum: ['beginner', 'intermediate', 'advanced'],
    example: 'beginner',
  })
  @IsOptional()
  @IsIn(['beginner', 'intermediate', 'advanced'])
  skillLevel?: string;

  @ApiProperty({ required: false, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiProperty({
    required: false,
    example: 5,
    minimum: 0,
    description:
      'Surcharge on top of `price`. Only charged when takeAdditionalPrice ' +
      'is true, so the amount can be configured and left switched off.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  additionalPrice?: number;

  @ApiProperty({
    required: false,
    example: false,
    description: 'Whether `additionalPrice` applies.',
  })
  @IsOptional()
  @IsBoolean()
  takeAdditionalPrice?: boolean;

  @ApiProperty({
    required: false,
    example: false,
    description: 'Whether members may bring guests (+1 / +2).',
  })
  @IsOptional()
  @IsBoolean()
  isAllowExtraPlayer?: boolean;

  @ApiProperty({
    required: false,
    example: 90,
    minimum: 60,
    description: 'Total event length in MINUTES, at least 60.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(1440)
  duration?: number;

  @ApiProperty({
    required: false,
    example: 120,
    minimum: 0,
    description:
      'How long before kick-off registration closes, in MINUTES. Same ' +
      'meaning and bounds as on event create.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10080)
  registrationClosingDuration?: number;
}
