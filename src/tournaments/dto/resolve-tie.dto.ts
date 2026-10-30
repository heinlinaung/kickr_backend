import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsMongoId,
  IsString,
  MinLength,
} from 'class-validator';

export class ResolveTieDto {
  @ApiProperty({
    description: 'The tied teams (tournament team ids), best first',
    example: ['665f1a2b3c4d5e6f7a8b9c0d', '665f1a2b3c4d5e6f7a8b9c0e'],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsMongoId({ each: true })
  order: string[];

  @ApiProperty({ example: 'Drawing of lots at the venue' })
  @IsString()
  @MinLength(3)
  reason: string;
}
