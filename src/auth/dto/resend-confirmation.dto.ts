import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ResendConfirmationDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  username: string;
}
