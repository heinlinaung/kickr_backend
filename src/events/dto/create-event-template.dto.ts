// src/events/dto/create-event-template.dto.ts
import { ApiProperty } from '@nestjs/swagger';
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
  MinLength,
} from 'class-validator';

/**
 * Body for `POST /event-templates` (spec §4.5).
 *
 * Only `name` is required — a template supplies whichever defaults the
 * organizer wants pre-filled and leaves the rest for the create call.
 */
export class CreateEventTemplateDto {
  @ApiProperty({ example: 'Tuesday 5-a-side' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsMongoId()
  groupId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @ApiProperty({ required: false, example: 24 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(100)
  maxPlayers?: number;

  @ApiProperty({ required: false, example: 4 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(6)
  teamCount?: number;

  @ApiProperty({ required: false, enum: ['football', 'futsal'] })
  @IsOptional()
  @IsIn(['football', 'futsal'])
  sportType?: string;

  @ApiProperty({
    required: false,
    enum: ['beginner', 'intermediate', 'advanced'],
  })
  @IsOptional()
  @IsIn(['beginner', 'intermediate', 'advanced'])
  skillLevel?: string;

  @ApiProperty({ required: false, example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
