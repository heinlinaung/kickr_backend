import { IsString, IsOptional, IsNumber, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;
}
