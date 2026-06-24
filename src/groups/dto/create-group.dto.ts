import { IsString, IsOptional, IsBoolean, IsNumber, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGroupDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;
}
