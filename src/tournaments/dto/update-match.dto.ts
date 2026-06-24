import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMatchDto {
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  scoreA: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  scoreB: number;

  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d', required: false })
  @IsOptional()
  @IsString()
  winnerId?: string;
}
