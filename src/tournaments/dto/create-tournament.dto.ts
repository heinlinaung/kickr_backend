import { IsString, IsOptional, IsEnum, IsNumber, IsDateString, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTournamentDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsEnum(['knockout', 'league'])
  type: string;

  @Type(() => Number)
  @IsNumber()
  maxTeams: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
