import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { GROUP_DRAWS } from '../tournament.constants';

export class LeagueDrawDto {
  @ApiPropertyOptional({
    enum: GROUP_DRAWS,
    description: "Default: the format's groupDraw",
  })
  @IsOptional()
  @IsEnum(GROUP_DRAWS)
  method?: (typeof GROUP_DRAWS)[number];

  @ApiPropertyOptional({
    description: 'SEEDED: team ids per pot, pot 1 (strongest) first',
    example: [
      ['t1', 't2'],
      ['t3', 't4'],
    ],
  })
  @IsOptional()
  @IsArray()
  @IsArray({ each: true })
  pots?: string[][];

  @ApiPropertyOptional({
    description: 'MANUAL: team ids per group, group A first',
    example: [
      ['t1', 't3'],
      ['t2', 't4'],
    ],
  })
  @IsOptional()
  @IsArray()
  @IsArray({ each: true })
  groups?: string[][];

  @ApiPropertyOptional({
    description: "Default: the format's separateSameClub",
  })
  @IsOptional()
  @IsBoolean()
  separateSameClub?: boolean;
}
