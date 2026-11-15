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
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  normaliseSlugs,
  SPORT_SLUG,
  SPORT_SLUG_MESSAGE,
  SubTypeDto,
  trimString,
} from './create-sport-type.dto';

// `value` is absent: it is the sport's ID, stored on groups, events and users,
// and never changes. A rename changes the display `name` only.
// `subTypes` is replaced as a whole list. Events store a subType's `value`,
// so dropping one still in use is refused; renaming changes `name` only.
// `playerRoles` IS here, replaced wholesale: nothing else stores a role yet,
// so there are no holders to migrate or protect.
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

  @ApiProperty({
    type: [String],
    example: ['goalkeeper', 'defender', 'midfielder', 'forward'],
    required: false,
    description:
      'Replaces the whole list of player roles, in display order. Send [] ' +
      'to clear. Deduplicated.',
  })
  @IsOptional()
  @Transform(normaliseSlugs)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(SPORT_SLUG, {
    each: true,
    message: `each playerRole ${SPORT_SLUG_MESSAGE}`,
  })
  playerRoles?: string[];

  @ApiProperty({
    type: [SubTypeDto],
    required: false,
    example: [
      { value: 'futsal', name: 'Futsal', sortOrder: 1 },
      { value: 'stadium', name: 'Stadium', sortOrder: 2 },
    ],
    description:
      'Replaces the whole list of formats. Keep a `value` to keep (or rename, via ' +
      '`name`) that format; leave it out to remove it. 409 if a removed one is ' +
      'still used by an event or event template; 400 on a repeated `value`. Send ' +
      '[] to clear.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SubTypeDto)
  subTypes?: SubTypeDto[];
}
