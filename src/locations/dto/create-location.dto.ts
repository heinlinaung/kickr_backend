import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsUrl,
  IsMongoId,
  MinLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLocationDto {
  @ApiProperty({ example: 'Lumpini Park Pitch 3', minLength: 2 })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 13.7563, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 100.5018, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiProperty({
    example: 'https://maps.google.com/?q=13.7563,100.5018',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiProperty({
    example: { surface: 'grass', indoor: false },
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiProperty({
    required: false,
    description:
      'Owning group. Omit for a personal location. When set, the group and ' +
      'its owner/admin/captain can manage the location — so the caller must ' +
      'be an owner or admin of that group.',
    example: '6a6b21217d15afe5f7856043',
  })
  @IsOptional()
  @IsMongoId()
  groupId?: string;
}
