import { ApiProperty } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsBoolean, IsNumber, IsEnum, IsDateString, MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEventDto {
  @ApiProperty({ example: 'Friday Night Football', minLength: 2 })
  @IsString()
  @MinLength(2)
  title: string;

  @ApiProperty({ example: 'Casual 11v11 match at the park', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2026-07-01T18:00:00.000Z' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d', required: false })
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({ example: 'Lumpini Park', required: false })
  @IsOptional()
  @IsString()
  locationName?: string;

  @ApiProperty({ example: 13.7563, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiProperty({ example: 100.5018, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiProperty({ example: 22, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;

  @ApiProperty({ enum: ['football', 'futsal'], example: 'football', required: false })
  @IsOptional()
  @IsEnum(['football', 'futsal'])
  sportType?: string;

  @ApiProperty({ enum: ['beginner', 'intermediate', 'advanced'], example: 'beginner', required: false })
  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced'])
  skillLevel?: string;

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;
}
