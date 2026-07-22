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

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private cognito: CognitoService,
  ) {}

  async signup(dto: SignupDto) {
    const email = dto.email.toLowerCase();
    const sub = await this.cognito.signUp(dto.username, dto.password, email);
    // Dual-write: Cognito owns the identity, Mongo the profile. If this create()
    // fails after Cognito succeeds (e.g. duplicate username), the Cognito user is
    // left without a profile. Recovery is an idempotent re-signup / retry — we do
    // not compensate with AdminDeleteUser here (own failure modes). See Task 7.
    await this.userModel.create({
      cognitoSub: sub,
      username: dto.username,
      name: dto.name,
      email,
    });
    return {
      message: 'Signup successful. Check your email to confirm your account.',
    };
  }

  async confirmSignup(dto: ConfirmSignupDto) {
    await this.cognito.confirmSignUp(dto.username, dto.code);
    return { message: 'Account confirmed. You can now log in.' };
  }

  async resendConfirmation(dto: ResendConfirmationDto) {
    await this.cognito.resendConfirmation(dto.username);
    return { message: 'Confirmation code resent.' };
  }

  async login(dto: LoginDto) {
    const tokens = await this.cognito.login(dto.username, dto.password);
    const user = await this.userModel
      .findOne({ username: dto.username })
      .lean();
    return { ...tokens, user };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    return this.cognito.refresh(dto.username, dto.refreshToken);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    await this.cognito.forgotPassword(dto.username);
    return { message: 'If that account exists, a reset code has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    await this.cognito.confirmForgotPassword(
      dto.username,
      dto.code,
      dto.newPassword,
    );
    return { message: 'Password reset successful. You can now log in.' };
  }
}
