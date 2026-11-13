import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  MinLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TOURNAMENT_FORMATS,
  MIN_TOTAL_DAYS,
  MAX_TOTAL_DAYS,
  MIN_REGISTER_CLOSE_DAYS,
  MAX_REGISTER_CLOSE_DAYS,
} from '../tournament.constants';

export class CreateTournamentDto {
  @ApiProperty({ example: 'Summer Cup 2026', minLength: 2 })
  @IsString()
  @MinLength(2)
  title: string;

  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d', required: false })
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiProperty({
    enum: TOURNAMENT_FORMATS,
    required: false,
    default: 'KNOCKOUT',
    description:
      'Settings start at their defaults; change them with PUT /tournaments/{id}/format',
  })
  @IsOptional()
  @IsEnum(TOURNAMENT_FORMATS)
  format?: (typeof TOURNAMENT_FORMATS)[number];

  @ApiProperty({
    enum: ['knockout', 'league'],
    required: false,
    deprecated: true,
    description: 'Use `format`',
  })
  @IsOptional()
  @IsEnum(['knockout', 'league'])
  type?: string;

  @ApiProperty({ example: 8 })
  @Type(() => Number)
  @IsNumber()
  maxTeams: number;

  @ApiProperty({ example: '2026-07-15T09:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    example: 7,
    required: false,
    minimum: MIN_TOTAL_DAYS,
    maximum: MAX_TOTAL_DAYS,
    description:
      'How many days the tournament runs, counted from `startDate` (or from creation when no ' +
      '`startDate`). Sets `endDate`; after it the tournament leaves the active listing and ' +
      'appears in history. Omit for a tournament that never expires by date.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_TOTAL_DAYS)
  @Max(MAX_TOTAL_DAYS)
  totalDays?: number;

  @ApiProperty({
    example: 3,
    required: false,
    minimum: MIN_REGISTER_CLOSE_DAYS,
    maximum: MAX_REGISTER_CLOSE_DAYS,
    description:
      'How many days registration stays open, counted from creation. Sets ' +
      '`registrationCloseAt`; after it no team can register (direct, QR / link or ' +
      'invitation). Must not end after `startDate` or `endDate`. Omit to keep registration ' +
      'open until the organizer closes it.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_REGISTER_CLOSE_DAYS)
  @Max(MAX_REGISTER_CLOSE_DAYS)
  registerCloseDuration?: number;
}
