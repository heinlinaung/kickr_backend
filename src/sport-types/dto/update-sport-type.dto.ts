// src/sport-types/dto/update-sport-type.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimString } from './create-sport-type.dto';

// `value` is absent: it is the sport's ID, stored on groups, events and users,
// and never changes. A rename changes the display `name` only.
// `subTypes` is absent: they are managed one at a time through the
// /sport-types/:value/sub-types endpoints (add, rename, reorder, remove).
export class UpdateSportTypeDto {
  @ApiProperty({
    example: 'Soccer',
    required: false,
    description:
      'Renames the sport (display label). `value` — the ID other documents ' +
      'store — stays the same. 409 if another sport has this name ' +
      '(case-insensitive).',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

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
