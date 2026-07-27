import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  /**
   * The Cognito `sub` (the `sub` claim on the tokens returned by login), NOT
   * the email. REFRESH_TOKEN_AUTH requires SECRET_HASH to be computed over the
   * user's real Cognito username, which for an email sign-in pool is this UUID.
   */
  @ApiProperty({ example: '69ca359c-b061-706f-947b-9332246bae1c' })
  @IsString()
  sub: string;

  @ApiProperty()
  @IsString()
  refreshToken: string;
}
