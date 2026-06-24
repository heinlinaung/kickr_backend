import {
  Injectable, BadRequestException, UnauthorizedException, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { User, UserDocument } from '../users/schemas/user.schema';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  private transporter: nodemailer.Transporter;

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('MAIL_HOST'),
      port: this.config.get<number>('MAIL_PORT'),
      auth: {
        user: this.config.get('MAIL_USER'),
        pass: this.config.get('MAIL_PASS'),
      },
    });
  }

  async signup(dto: SignupDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const emailVerificationToken = uuidv4();

    let user;
    try {
      user = await this.userModel.create({
        name: dto.name,
        email: dto.email.toLowerCase(),
        passwordHash,
        emailVerificationToken,
        emailVerified: false,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException('Email already registered');
      }
      throw err;
    }

    const baseUrl = this.config.get('APP_BASE_URL');
    try {
      await this.transporter.sendMail({
        from: this.config.get('MAIL_FROM'),
        to: user.email,
        subject: 'Confirm your KicKR account',
        html: `<p>Hi ${user.name},</p>
               <p>Click the link to confirm your email:</p>
               <a href="${baseUrl}/auth/confirm-email?token=${emailVerificationToken}">Confirm Email</a>`,
      });
    } catch (err) {
      await this.userModel.findByIdAndDelete(user._id);
      throw new ServiceUnavailableException('Failed to send confirmation email. Please try again later.');
    }

    return { message: 'Signup successful. Check your email to confirm your account.' };
  }

  async confirmEmail(token: string) {
    const user = await this.userModel.findOne({ emailVerificationToken: token });
    if (!user) throw new BadRequestException('Invalid or expired confirmation token');

    user.emailVerified = true;
    user.set('emailVerificationToken', undefined);
    await user.save();

    return { message: 'Email confirmed. You can now log in.' };
  }

  async login(dto: LoginDto) {
    const user = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.emailVerified) throw new UnauthorizedException('Invalid credentials');

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    const token = this.jwtService.sign({ sub: (user._id as any).toString() });
    return { token, user };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (!user) return { message: 'If that email exists, a reset link has been sent.' };

    const resetToken = uuidv4();
    user.passwordResetToken = resetToken;
    user.passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const baseUrl = this.config.get('APP_BASE_URL');
    try {
      await this.transporter.sendMail({
        from: this.config.get('MAIL_FROM'),
        to: user.email,
        subject: 'KicKR password reset',
        html: `<p>Click the link to reset your password (valid 1 hour):</p>
               <a href="${baseUrl}/auth/reset-password?token=${resetToken}">Reset Password</a>`,
      });
    } catch (err) {
      console.error('Mail send failed:', (err as Error).message);
    }

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userModel.findOne({
      passwordResetToken: dto.token,
      passwordResetExpiry: { $gt: new Date() },
    });
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    user.set('passwordResetToken', undefined);
    user.set('passwordResetExpiry', undefined);
    await user.save();

    return { message: 'Password reset successful. You can now log in.' };
  }
}
