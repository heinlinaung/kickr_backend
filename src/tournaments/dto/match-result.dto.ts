import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MATCH_SIDES } from '../tournament.constants';

export class PenaltiesDto {
  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(0)
  home: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  away: number;
}

export class CardCountDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  yellow?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  red?: number;
}

export class MatchCardsDto {
  @ApiPropertyOptional({ type: CardCountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CardCountDto)
  home?: CardCountDto;

  @ApiPropertyOptional({ type: CardCountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CardCountDto)
  away?: CardCountDto;
}

export class MatchResultDto {
  @ApiPropertyOptional({
    example: 2,
    description: 'Required unless `forfeit` is set',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  homeGoals?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Required unless `forfeit` is set',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  awayGoals?: number;

  @ApiPropertyOptional({
    type: PenaltiesDto,
    description: 'Knockout only, when the score is level',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PenaltiesDto)
  penalties?: PenaltiesDto;

  @ApiPropertyOptional({ type: MatchCardsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MatchCardsDto)
  cards?: MatchCardsDto;

  @ApiPropertyOptional({
    enum: MATCH_SIDES,
    description:
      "The side that forfeited or didn't show: recorded 3–0 (league) or a walkover (knockout)",
  })
  @IsOptional()
  @IsEnum(MATCH_SIDES)
  forfeit?: (typeof MATCH_SIDES)[number];
}
