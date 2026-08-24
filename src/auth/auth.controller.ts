import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessToken } from '../common/decorators/access-token.decorator';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ConfirmSignupDto } from './dto/confirm-signup.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('confirm-signup')
  @HttpCode(HttpStatus.OK)
  confirmSignup(@Body() dto: ConfirmSignupDto) {
    return this.authService.confirmSignup(dto);
  }

  @Post('resend-confirmation')
  @HttpCode(HttpStatus.OK)
  resendConfirmation(@Body() dto: ResendConfirmationDto) {
    return this.authService.resendConfirmation(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto);
  }

  /**
   * The only authenticated route on this controller — every other password
   * flow here is for someone who cannot log in. This one is for someone who
   * already is.
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change your own password (requires the current one)',
    description:
      'Changes the password of the authenticated caller. The account is taken ' +
      'from the access token, never from the body — there is no email field, ' +
      'so this cannot be aimed at another account. `currentPassword` must be ' +
      'correct: a wrong one is 401, and reusing it as `newPassword` is 400. ' +
      'A new password that fails the Cognito policy is 400 with the reason. ' +
      'Use POST /auth/forgot-password instead when the user cannot log in. ' +
      'Existing sessions on other devices stay valid.',
  })
  changePassword(
    @AccessToken() accessToken: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(accessToken, dto);
  }
}
