import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  // Optional rather than required: making it mandatory would break clients
  // already signing up with just email + password. When omitted the service
  // falls back to the email's local part.
  @ApiProperty({
    example: 'Thar Htet',
    required: false,
    minLength: 2,
    maxLength: 60,
    description:
      "Display name. Falls back to the email's local part if omitted.",
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;
}
