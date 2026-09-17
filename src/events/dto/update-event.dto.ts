import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsInt,
  IsEnum,
  IsDateString,
  IsMongoId,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Editable event fields. Every field is optional — a PATCH applies only what
 * it carries.
 *
 * Deliberately NOT editable here:
 *   status      — goes through PATCH /events/:id/status so the transition
 *                 table is the only way the lifecycle moves.
 *   groupId     — re-homing an event would move it under a different
 *                 permission set mid-flight.
 *   joinedCount — derived from EventPlayer rows.
 */
export class UpdateEventDto {
  @ApiProperty({ example: 'Friday Night Football', required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @ApiProperty({ example: 'Casual 11v11 at the park', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2026-07-01T18:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({ example: '507f1f77bcf86cd799439011', required: false })
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @ApiProperty({ example: 22, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxPlayers?: number;

  @ApiProperty({
    example: 4,
    required: false,
    description:
      'Colour teams to split into (2-6). Used by the client shuffle.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2)
  @Max(6)
  teamCount?: number;

  @ApiProperty({
    example: 90,
    required: false,
    minimum: 60,
    description:
      'Total event length in MINUTES, at least 60. Changing it after teams ' +
      'are generated does NOT re-derive the fixture list — regenerate to ' +
      'pick up a new duration.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(60)
  @Max(1440)
  duration?: number;

  @ApiProperty({
    example: 120,
    required: false,
    minimum: 0,
    description:
      'How long before kick-off registration closes, in MINUTES. NOT the ' +
      'same as `duration`, which is how long the event RUNS. 0 keeps ' +
      'registration open until kick-off. Stored as an offset from the start, ' +
      'so rescheduling the event moves the deadline with it.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10080)
  registrationClosingDuration?: number;

  @ApiProperty({
    example: 'football',
    required: false,
    description:
      'One of the values from GET /sport-types — checked against that ' +
      'collection in the service, not a hardcoded list here. On a GROUP ' +
      'event it cannot change: an event with a groupId always carries its ' +
      "group's sportType, so any other value is a 400 (change the group's " +
      'sportType instead, which propagates). Only a standalone event can be ' +
      'switched.',
  })
  @IsOptional()
  @IsString()
  sportType?: string;

  @ApiProperty({
    example: 'stadium',
    required: false,
    description:
      'Format of the event, e.g. a FOOTBALL event is `futsal` or `stadium`. ' +
      'Only valid when the resolved sportType lists it in its `subTypes` on ' +
      'GET /sport-types — sending it for a sport with no formats is a 400, ' +
      'since it would mean nothing there. Omit it for "unspecified"; that is ' +
      'what every event created before this field existed reads as, and it ' +
      'is NOT a synonym for stadium.',
  })
  @IsOptional()
  @IsString()
  subType?: string;

  @ApiProperty({
    enum: ['beginner', 'intermediate', 'advanced'],
    example: 'beginner',
    required: false,
  })
  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced'])
  skillLevel?: string;

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiProperty({
    example: 5,
    required: false,
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
    example: false,
    required: false,
    description: 'Whether `additionalPrice` applies. Defaults to false.',
  })
  @IsOptional()
  @IsBoolean()
  takeAdditionalPrice?: boolean;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Whether members may bring guests (+1 / +2) to this event. Defaults ' +
      'to false — guests are opt-in. Only members who have JOINED the event ' +
      'may add one. Turning it off later does not remove approved guests.',
  })
  @IsOptional()
  @IsBoolean()
  isAllowExtraPlayer?: boolean;

  @ApiProperty({ example: '2026-07-01T18:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiProperty({ example: '2026-07-01T20:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  endTime?: string;
}
