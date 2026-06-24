import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMatchDto {
  @Type(() => Number)
  @IsNumber()
  scoreA: number;

  @Type(() => Number)
  @IsNumber()
  scoreB: number;

  @IsOptional()
  @IsString()
  winnerId?: string;
}
