import { Injectable } from '@nestjs/common';
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
    // Signup collects only email + password, but `name` is required on the
    // schema, so seed it from the email's local part. Users rename themselves
    // (and pick a `username`) later via PATCH /users/me.
    await this.userModel.create({
      cognitoSub: sub,
      name: defaultNameFromEmail(email),
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
}
