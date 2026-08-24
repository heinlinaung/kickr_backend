import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CognitoService } from './cognito/cognito.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ConfirmSignupDto } from './dto/confirm-signup.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * Seed a display name from an email's local part ('john.doe@x.com' -> 'john.doe').
 * Falls back to the whole address if the local part is too short to be a name.
 */
export function defaultNameFromEmail(email: string): string {
  const localPart = email.slice(0, email.lastIndexOf('@'));
  return localPart.length >= 2 ? localPart : email;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private cognito: CognitoService,
  ) {}

  async signup(dto: SignupDto) {
    const email = dto.email.toLowerCase();
    const sub = await this.cognito.signUp(email, dto.password);
    // Dual-write: Cognito owns the identity, Mongo the profile. If this create()
    // fails after Cognito succeeds (e.g. duplicate email), the Cognito user is
    // left without a profile. Recovery is an idempotent re-signup / retry — we do
    // not compensate with AdminDeleteUser here (own failure modes). See Task 7.
    //
    // `name` is optional on the DTO but required on the schema. Use what the
    // user typed when present, else seed from the email's local part. The trim
    // matters: a whitespace-only name would otherwise persist as a blank
    // display name instead of falling back.
    await this.userModel.create({
      cognitoSub: sub,
      name: dto.name?.trim() || defaultNameFromEmail(email),
      email,
    });
    return {
      // A pre-sign-up Lambda auto-confirms the user, so there is no emailed
      // code to wait for — they can log in straight away.
      message: 'Signup successful. You can now log in.',
    };
  }

  async confirmSignup(dto: ConfirmSignupDto) {
    await this.cognito.confirmSignUp(dto.email.toLowerCase(), dto.code);
    return { message: 'Account confirmed. You can now log in.' };
  }

  async resendConfirmation(dto: ResendConfirmationDto) {
    await this.cognito.resendConfirmation(dto.email.toLowerCase());
    return { message: 'Confirmation code resent.' };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const tokens = await this.cognito.login(email, dto.password);
    const user = await this.userModel.findOne({ email }).lean();
    // `sub` is surfaced explicitly because POST /auth/refresh requires it —
    // the refresh flow cannot be driven by the email alone.
    return { ...tokens, sub: user?.cognitoSub, user };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    return this.cognito.refresh(dto.sub, dto.refreshToken);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    await this.cognito.forgotPassword(dto.email.toLowerCase());
    return { message: 'If that account exists, a reset code has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    await this.cognito.confirmForgotPassword(
      dto.email.toLowerCase(),
      dto.code,
      dto.newPassword,
    );
    return { message: 'Password reset successful. You can now log in.' };
  }

  /**
   * Changes the password of the caller identified by `accessToken`.
   *
   * Distinct from `resetPassword`, which is the forgotten-password path and
   * proves identity with an emailed code. This one proves it with the current
   * password, so it needs no email round trip — but it does need the current
   * password: without that check, a stolen access token could rotate the
   * password and lock the real owner out permanently.
   *
   * The identity comes from the token, never from the body. There is no `email`
   * field to spoof, so one user cannot aim this at another's account.
   */
  async changePassword(accessToken: string, dto: ChangePasswordDto) {
    // Cognito treats "new == old" as a successful no-op, which would report
    // success while nothing actually rotated.
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must differ from the current password',
      );
    }

    await this.cognito.changePassword(
      accessToken,
      dto.currentPassword,
      dto.newPassword,
    );

    // Deliberately does not return tokens: the existing access token stays
    // valid, so the client needs no re-login to keep working.
    return { message: 'Password changed successfully.' };
  }
}
