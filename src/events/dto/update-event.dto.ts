import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
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
    description: 'Colour teams to split into (2-6). Used by the client shuffle.',
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
    enum: ['football', 'futsal'],
    example: 'football',
    required: false,
  })
  @IsOptional()
  @IsEnum(['football', 'futsal'])
  sportType?: string;

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

  @ApiProperty({ example: '2026-07-01T18:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiProperty({ example: '2026-07-01T20:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  endTime?: string;
}
