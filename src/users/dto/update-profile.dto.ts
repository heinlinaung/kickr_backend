import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProfileDto {
  @ApiProperty({ example: 'John Doe', minLength: 2, required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiProperty({ example: 'johndoe', minLength: 3, required: false })
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @ApiProperty({ example: 'Johnny', required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ example: '+66812345678', required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ example: 175, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  height?: number;

  @ApiProperty({ example: 70, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weight?: number;
}
