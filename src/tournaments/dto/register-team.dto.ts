import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, MinLength } from 'class-validator';

export class RegisterTeamDto {
  @ApiProperty({ example: 'Team Alpha', minLength: 2 })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: ['665f1a2b3c4d5e6f7a8b9c0d', '665f1a2b3c4d5e6f7a8b9c0e'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  players: string[];

  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d', required: false })
  @IsOptional()
  @IsString()
  captainId?: string;
}
