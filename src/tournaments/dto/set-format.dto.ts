import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BRACKET_SEEDINGS,
  DRAW_RESOLUTIONS,
  GROUP_DRAWS,
  ROUND_ROBINS,
  SEEDINGS,
  TIEBREAKERS,
  TOURNAMENT_FORMATS,
} from '../tournament.constants';

export class PointsDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  win: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  draw: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  loss: number;
}

export class LeagueSettingsDto {
  @ApiPropertyOptional({ example: 2, description: '1 = one combined table' })
  @IsOptional()
  @IsInt()
  @Min(1)
  groupCount?: number;

  @ApiPropertyOptional({
    example: 4,
    minimum: 3,
    maximum: 8,
    description: 'Default: team count ÷ groups',
  })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(8)
  teamsPerGroup?: number;

  @ApiPropertyOptional({ enum: ROUND_ROBINS, default: 'SINGLE' })
  @IsOptional()
  @IsEnum(ROUND_ROBINS)
  roundRobin?: (typeof ROUND_ROBINS)[number];

  @ApiPropertyOptional({ type: PointsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PointsDto)
  points?: PointsDto;

  @ApiPropertyOptional({ enum: GROUP_DRAWS, default: 'RANDOM' })
  @IsOptional()
  @IsEnum(GROUP_DRAWS)
  groupDraw?: (typeof GROUP_DRAWS)[number];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  separateSameClub?: boolean;

  @ApiPropertyOptional({
    enum: TIEBREAKERS,
    isArray: true,
    example: TIEBREAKERS,
  })
  @IsOptional()
  @IsIn(TIEBREAKERS, { each: true })
  @ArrayUnique()
  tiebreakers?: (typeof TIEBREAKERS)[number][];
}

export class QualificationSettingsDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  qualifyPerGroup?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Extra places for the best teams just below the cut',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  bestOfRest?: number;

  @ApiPropertyOptional({ enum: SEEDINGS, default: 'CROSS_GROUP' })
  @IsOptional()
  @IsEnum(SEEDINGS)
  seeding?: (typeof SEEDINGS)[number];
}

export class KnockoutSettingsDto {
  @ApiPropertyOptional({ enum: [1, 2], default: 1 })
  @IsOptional()
  @IsIn([1, 2])
  legs?: 1 | 2;

  @ApiPropertyOptional({ enum: DRAW_RESOLUTIONS, default: 'PENALTIES' })
  @IsOptional()
  @IsEnum(DRAW_RESOLUTIONS)
  drawResolution?: (typeof DRAW_RESOLUTIONS)[number];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  thirdPlaceMatch?: boolean;

  @ApiPropertyOptional({
    enum: BRACKET_SEEDINGS,
    default: 'RANDOM_DRAW',
    description: 'Knockout-only tournaments',
  })
  @IsOptional()
  @IsEnum(BRACKET_SEEDINGS)
  bracketSeeding?: (typeof BRACKET_SEEDINGS)[number];
}

export class SetFormatDto {
  @ApiProperty({ enum: TOURNAMENT_FORMATS, example: 'LEAGUE_KNOCKOUT' })
  @IsEnum(TOURNAMENT_FORMATS)
  format: (typeof TOURNAMENT_FORMATS)[number];

  @ApiPropertyOptional({ type: LeagueSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LeagueSettingsDto)
  league?: LeagueSettingsDto;

  @ApiPropertyOptional({ type: QualificationSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QualificationSettingsDto)
  qualification?: QualificationSettingsDto;

  @ApiPropertyOptional({ type: KnockoutSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => KnockoutSettingsDto)
  knockout?: KnockoutSettingsDto;

  @ApiPropertyOptional({
    description:
      'Required to change structure after a phase has started (only before any result in it)',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
