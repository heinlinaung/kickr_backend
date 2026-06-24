import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNumber, IsDateString, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTournamentDto {
  @ApiProperty({ example: 'Summer Cup 2026', minLength: 2 })
  @IsString()
  @MinLength(2)
  title: string;

  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d', required: false })
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiProperty({ enum: ['knockout', 'league'], example: 'knockout' })
  @IsEnum(['knockout', 'league'])
  type: string;

  @ApiProperty({ example: 8 })
  @Type(() => Number)
  @IsNumber()
  maxTeams: number;

  @ApiProperty({ example: '2026-07-15T09:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;
}
