import { IsString, IsArray, IsOptional, MinLength } from 'class-validator';

export class RegisterTeamDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsArray()
  @IsString({ each: true })
  players: string[];

  @IsOptional()
  @IsString()
  captainId?: string;
}
