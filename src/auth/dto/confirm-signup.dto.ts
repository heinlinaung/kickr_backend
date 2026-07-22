import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ConfirmSignupDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  username: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  code: string;
}
