import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsUrl,
  MinLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

// createdBy is intentionally absent: ownership is never client-settable.
export class UpdateLocationDto {
  @ApiProperty({ example: 'Lumpini Park Pitch 3', minLength: 2, required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiProperty({ example: 13.7563, minimum: -90, maximum: 90, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiProperty({ example: 100.5018, minimum: -180, maximum: 180, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiProperty({ example: 'https://maps.google.com/?q=13.7563,100.5018', required: false })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiProperty({ example: { surface: 'grass', indoor: false }, required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
