import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  // No @MinLength here: this is the password the user ALREADY has. Enforcing
  // the current policy on it would reject a legitimate older password that
  // predates a policy change — locking the user out of the very endpoint that
  // would let them fix it. Cognito verifies it; length is not our business.
  @ApiProperty({ example: 'OldPassword123!' })
  @IsString()
  currentPassword: string;

  // MinLength(8) mirrors SignupDto/ResetPasswordDto so an obviously-too-short
  // password fails fast. Cognito still owns the real policy (symbols, digits,
  // case) and its rejection message is passed through verbatim.
  @ApiProperty({ example: 'NewPassword456!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
