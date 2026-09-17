import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEnum,
  IsDateString,
  IsInt,
  IsMongoId,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEventDto {
  @ApiProperty({ example: 'Friday Night Football', minLength: 2 })
  @IsString()
  @MinLength(2)
  title: string;

  @ApiProperty({ example: 'Casual 11v11 match at the park', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2026-07-01T18:00:00.000Z' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d', required: false })
  @IsOptional()
  @IsString()
  groupId?: string;

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
  maxPlayers?: number;

  @ApiProperty({
    example: 'football',
    required: false,
    description:
      'One of the values from GET /sport-types — checked against that ' +
      'collection in the service, not a hardcoded list here. Ignored on a ' +
      'GROUP event unless it matches: an event with a groupId always takes ' +
      "its group's sportType, and sending a different value is a 400. Only " +
      'a standalone event chooses its own.',
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

  @ApiProperty({
    example: '2026-07-01T18:00:00.000Z',
    required: false,
    description: 'Kick-off time; `date` remains the scheduling field.',
  })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiProperty({ example: '2026-07-01T20:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiProperty({
    example: 4,
    required: false,
    description: 'How many colour teams to split into. Advisory (spec §4.3.1).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(6)
  teamCount?: number;

  @ApiProperty({
    example: '665f1a2b3c4d5e6f7a8b9c0d',
    required: false,
    description: 'Fills any field omitted above; never overrides what is sent.',
  })
  @IsOptional()
  @IsMongoId()
  templateId?: string;

  @ApiProperty({
    example: 90,
    required: false,
    minimum: 60,
    description:
      'Total event length in MINUTES, at least 60. Drives fixture generation: ' +
      'floor((duration - 10) / match duration) matches.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(1440)
  duration?: number;

  @ApiProperty({
    example: 120,
    required: false,
    minimum: 0,
    description:
      'How long before kick-off registration closes, in MINUTES. NOT the ' +
      'same as `duration`, which is how long the event RUNS — same unit, ' +
      'opposite direction: this counts backward from the start. ' +
      '120 closes registration two hours before; 0 (the default) keeps it ' +
      'open right up to kick-off, which is the behaviour of every event ' +
      'created before this field existed. Stored as an offset, so moving the ' +
      'event moves the deadline with it.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  // Capped at a week. An offset longer than that is far more likely to be a
  // unit mix-up — hours or days entered as minutes — than a real intention,
  // and rejecting it says so rather than silently closing registration before
  // the event was even announced.
  @Max(10080)
  registrationClosingDuration?: number;
}
