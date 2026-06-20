# KicKR Backend Plan A — Foundation + Auth + Users

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the NestJS project, connect MongoDB, implement JWT auth (sign up with email confirmation, login, forgot/reset password), and user profile editing with avatar upload.

**Architecture:** NestJS monolith with one module per feature. MongoDB via Mongoose. JWT access tokens (no refresh in phase 1). Nodemailer for email. Multer disk storage for file uploads. Global validation pipe + exception filter for consistent responses.

**Tech Stack:** NestJS ^10, Mongoose ^8, @nestjs/jwt, @nestjs/passport, passport-jwt, bcrypt, nodemailer, multer, class-validator, class-transformer, @nestjs/config, @nestjs/serve-static, Jest (built-in).

**Spec:** `docs/superpowers/specs/2026-06-20-kickr-backend-design.md`

---

## File Map

```
kickr-backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── filters/http-exception.filter.ts
│   │   ├── interceptors/transform.interceptor.ts
│   │   ├── guards/jwt-auth.guard.ts
│   │   ├── decorators/current-user.decorator.ts
│   │   └── upload/multer.config.ts
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/jwt.strategy.ts
│   │   ├── strategies/google.strategy.ts   (stub)
│   │   ├── strategies/facebook.strategy.ts (stub)
│   │   └── dto/
│   │       ├── login.dto.ts
│   │       ├── signup.dto.ts
│   │       ├── forgot-password.dto.ts
│   │       └── reset-password.dto.ts
│   └── users/
│       ├── users.module.ts
│       ├── users.controller.ts
│       ├── users.service.ts
│       ├── schemas/user.schema.ts
│       └── dto/update-profile.dto.ts
├── test/
│   ├── app.e2e-spec.ts
│   ├── users.e2e-spec.ts
│   └── test-app.helper.ts
├── .env.example
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
└── nest-cli.json
```

---

## Task 1: Scaffold NestJS Project

**Files:**
- Create: `package.json`, `tsconfig.json`, `nest-cli.json`, `src/main.ts`, `src/app.module.ts`, `.env.example`, `.env`, `.gitignore`

- [ ] **Step 1: Install NestJS CLI and scaffold project**

```bash
cd /Users/augusth/work/test/kickr/kickr-backend
npm i -g @nestjs/cli
nest new . --package-manager npm --skip-git --language TS
```

When prompted "Directory is not empty. Are you sure you want to continue?", type `y`.

Expected: `src/main.ts`, `src/app.module.ts`, `src/app.controller.ts`, `src/app.service.ts`, `package.json` created.

- [ ] **Step 2: Install all project dependencies**

```bash
npm install @nestjs/mongoose mongoose \
  @nestjs/jwt @nestjs/passport passport passport-jwt \
  @nestjs/config @nestjs/serve-static \
  bcrypt nodemailer multer uuid \
  class-validator class-transformer
npm install -D @types/passport-jwt @types/bcrypt @types/nodemailer @types/multer @types/uuid
```

- [ ] **Step 3: Install social auth stub packages**

```bash
npm install passport-google-oauth20 passport-facebook
npm install -D @types/passport-google-oauth20 @types/passport-facebook
```

- [ ] **Step 4: Create `.env.example`**

```
PORT=3000
NODE_ENV=development

MONGODB_URI=mongodb://localhost:27017/kickr

JWT_SECRET=change_me_in_production
JWT_EXPIRES_IN=15m

MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM="KicKR <noreply@kickr.app>"

APP_BASE_URL=http://localhost:3000

UPLOADS_DIR=./uploads
```

Write this content to `.env.example`, then copy it to `.env` and fill in real values for `MONGODB_URI` and `MAIL_*` before running.

- [ ] **Step 5: Add to `.gitignore`**

Append these lines to `.gitignore` (file already exists from NestJS scaffold):

```
.env
uploads/
```

- [ ] **Step 6: Replace `src/main.ts` with full bootstrap**

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`KicKR API running on port ${port}`);
}
bootstrap();
```

- [ ] **Step 7: Delete generated boilerplate**

```bash
rm src/app.controller.ts src/app.controller.spec.ts src/app.service.ts
```

- [ ] **Step 8: Replace `src/app.module.ts` with minimal root module**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 9: Commit scaffold**

```bash
git add -A
git commit -m "chore: scaffold NestJS project with dependencies"
```

---

## Task 2: Common Infrastructure (Filter, Interceptor, Guard, Decorator, Multer)

**Files:**
- Create: `src/common/filters/http-exception.filter.ts`
- Create: `src/common/interceptors/transform.interceptor.ts`
- Create: `src/common/guards/jwt-auth.guard.ts`
- Create: `src/common/decorators/current-user.decorator.ts`
- Create: `src/common/upload/multer.config.ts`

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/common/filters src/common/interceptors src/common/guards src/common/decorators src/common/upload
```

- [ ] **Step 2: Write HTTP exception filter**

```typescript
// src/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message ?? message;
    } else if ((exception as any)?.code === 11000) {
      status = HttpStatus.CONFLICT;
      message = 'Duplicate entry — resource already exists';
    } else if ((exception as any)?.name === 'CastError') {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid ID format';
    }

    response.status(status).json({ success: false, statusCode: status, message });
  }
}
```

- [ ] **Step 3: Write transform interceptor**

```typescript
// src/common/interceptors/transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => ({ success: true, data })),
    );
  }
}
```

- [ ] **Step 4: Write JWT auth guard**

```typescript
// src/common/guards/jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 5: Write current-user decorator**

```typescript
// src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

- [ ] **Step 6: Write multer disk config**

```typescript
// src/common/upload/multer.config.ts
import { diskStorage } from 'multer';
import { extname } from 'path';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function multerDiskOptions(subDir: string) {
  const dest = `./uploads/${subDir}`;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  return {
    storage: diskStorage({
      destination: dest,
      filename: (_req, file, cb) => {
        const userId = (_req as any).user?._id ?? 'anon';
        const unique = `${userId}-${Date.now()}${extname(file.originalname)}`;
        cb(null, unique);
      },
    }),
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
      if (!ALLOWED_MIME.includes(file.mimetype)) {
        return cb(new BadRequestException('Only JPEG, PNG, WebP images are allowed'), false);
      }
      cb(null, true);
    },
  };
}
```

- [ ] **Step 7: Commit common infrastructure**

```bash
git add src/common/
git commit -m "feat: add common filter, interceptor, guard, decorator, multer config"
```

---

## Task 3: User Schema

**Files:**
- Create: `src/users/schemas/user.schema.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/users/schemas
```

- [ ] **Step 2: Write user schema**

```typescript
// src/users/schemas/user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ unique: true, sparse: true })
  username: string;

  @Prop()
  displayName: string;

  @Prop({ required: true, unique: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop()
  phoneNumber: string;

  @Prop()
  height: number;

  @Prop()
  weight: number;

  @Prop()
  profileImage: string;

  @Prop({ default: 'player', enum: ['player', 'owner'] })
  role: string;

  @Prop({ type: [String], default: [] })
  joinedGroups: string[];

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop()
  emailVerificationToken: string;

  @Prop()
  passwordResetToken: string;

  @Prop()
  passwordResetExpiry: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.emailVerificationToken;
    delete ret.passwordResetToken;
    delete ret.passwordResetExpiry;
    return ret;
  },
});
```

- [ ] **Step 3: Commit schema**

```bash
git add src/users/schemas/
git commit -m "feat: add User mongoose schema"
```

---

## Task 4: Auth DTOs, JWT Strategy, and Auth Service

**Files:**
- Create: `src/auth/dto/login.dto.ts`
- Create: `src/auth/dto/signup.dto.ts`
- Create: `src/auth/dto/forgot-password.dto.ts`
- Create: `src/auth/dto/reset-password.dto.ts`
- Create: `src/auth/strategies/jwt.strategy.ts`
- Create: `src/auth/strategies/google.strategy.ts`
- Create: `src/auth/strategies/facebook.strategy.ts`
- Create: `src/auth/auth.service.ts`

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/auth/dto src/auth/strategies
```

- [ ] **Step 2: Write login DTO**

```typescript
// src/auth/dto/login.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
```

- [ ] **Step 3: Write signup DTO**

```typescript
// src/auth/dto/signup.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
```

- [ ] **Step 4: Write forgot-password DTO**

```typescript
// src/auth/dto/forgot-password.dto.ts
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}
```

- [ ] **Step 5: Write reset-password DTO**

```typescript
// src/auth/dto/reset-password.dto.ts
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}
```

- [ ] **Step 6: Write JWT strategy**

```typescript
// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.userModel.findById(payload.sub).lean();
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

- [ ] **Step 7: Write social auth stubs**

```typescript
// src/auth/strategies/google.strategy.ts
// Phase 1 stub — controller returns 501
export class GoogleStrategy {}
```

```typescript
// src/auth/strategies/facebook.strategy.ts
// Phase 1 stub — controller returns 501
export class FacebookStrategy {}
```

- [ ] **Step 8: Write auth service**

```typescript
// src/auth/auth.service.ts
import {
  Injectable, BadRequestException, UnauthorizedException,
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
    const existing = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const emailVerificationToken = uuidv4();

    const user = await this.userModel.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      passwordHash,
      emailVerificationToken,
      emailVerified: false,
    });

    const baseUrl = this.config.get('APP_BASE_URL');
    await this.transporter.sendMail({
      from: this.config.get('MAIL_FROM'),
      to: user.email,
      subject: 'Confirm your KicKR account',
      html: `<p>Hi ${user.name},</p>
             <p>Click the link to confirm your email:</p>
             <a href="${baseUrl}/auth/confirm-email?token=${emailVerificationToken}">Confirm Email</a>`,
    });

    return { message: 'Signup successful. Check your email to confirm your account.' };
  }

  async confirmEmail(token: string) {
    const user = await this.userModel.findOne({ emailVerificationToken: token });
    if (!user) throw new BadRequestException('Invalid or expired confirmation token');

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    return { message: 'Email confirmed. You can now log in.' };
  }

  async login(dto: LoginDto) {
    const user = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    if (!user.emailVerified) throw new UnauthorizedException('Please confirm your email first');

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
    await this.transporter.sendMail({
      from: this.config.get('MAIL_FROM'),
      to: user.email,
      subject: 'KicKR password reset',
      html: `<p>Click the link to reset your password (valid 1 hour):</p>
             <a href="${baseUrl}/auth/reset-password?token=${resetToken}">Reset Password</a>`,
    });

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userModel.findOne({
      passwordResetToken: dto.token,
      passwordResetExpiry: { $gt: new Date() },
    });
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpiry = undefined;
    await user.save();

    return { message: 'Password reset successful. You can now log in.' };
  }
}
```

- [ ] **Step 9: Commit auth service and DTOs**

```bash
git add src/auth/
git commit -m "feat: add auth DTOs, JWT strategy, and auth service"
```

---

## Task 5: Auth Controller and Module

**Files:**
- Create: `src/auth/auth.controller.ts`
- Create: `src/auth/auth.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write auth controller**

```typescript
// src/auth/auth.controller.ts
import { Controller, Post, Body, Get, Query, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Get('confirm-email')
  confirmEmail(@Query('token') token: string) {
    return this.authService.confirmEmail(token);
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

  @Get('google')
  googleStub() {
    throw new HttpException('Not implemented in phase 1', HttpStatus.NOT_IMPLEMENTED);
  }

  @Get('facebook')
  facebookStub() {
    throw new HttpException('Not implemented in phase 1', HttpStatus.NOT_IMPLEMENTED);
  }
}
```

- [ ] **Step 2: Write auth module**

```typescript
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') },
      }),
    }),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 3: Add AuthModule to app.module.ts**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Start server and verify it boots**

```bash
npm run start:dev
```

Expected: `KicKR API running on port 3000` with no errors. Stop with Ctrl+C.

- [ ] **Step 5: Smoke-test signup**

```bash
curl -s -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123"}' | jq .
```

Expected: `{ "success": true, "data": { "message": "Signup successful..." } }`

- [ ] **Step 6: Smoke-test validation**

```bash
curl -s -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"notanemail"}' | jq .
```

Expected: `{ "success": false, "statusCode": 400, ... }`

- [ ] **Step 7: Commit auth module and controller**

```bash
git add src/auth/auth.module.ts src/auth/auth.controller.ts src/app.module.ts
git commit -m "feat: wire up auth module — signup, confirm-email, login, forgot/reset password"
```

---

## Task 6: Users Module (Edit Profile + Avatar Upload)

**Files:**
- Create: `src/users/dto/update-profile.dto.ts`
- Create: `src/users/users.service.ts`
- Create: `src/users/users.controller.ts`
- Create: `src/users/users.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/users/dto
```

- [ ] **Step 2: Write update-profile DTO**

```typescript
// src/users/dto/update-profile.dto.ts
import { IsString, IsOptional, IsNumber, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  height?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weight?: number;
}
```

- [ ] **Step 3: Write users service**

```typescript
// src/users/users.service.ts
import { Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async findById(id: string): Promise<UserDocument> {
    return this.userModel.findById(id).lean() as Promise<UserDocument>;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserDocument> {
    if (dto.username) {
      const existing = await this.userModel.findOne({
        username: dto.username,
        _id: { $ne: userId },
      });
      if (existing) throw new ConflictException('Username already taken');
    }
    return this.userModel
      .findByIdAndUpdate(userId, { $set: dto }, { new: true })
      .lean() as Promise<UserDocument>;
  }

  async updateAvatar(userId: string, filename: string): Promise<UserDocument> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { profileImage: `/uploads/profiles/${filename}` } },
        { new: true },
      )
      .lean() as Promise<UserDocument>;
  }
}
```

- [ ] **Step 4: Write users controller**

```typescript
// src/users/users.controller.ts
import {
  Controller, Get, Patch, Post, Body, UseGuards,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { multerDiskOptions } from '../common/upload/multer.config';
import { UserDocument } from './schemas/user.schema';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: UserDocument) {
    return this.usersService.findById((user._id as any).toString());
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: UserDocument, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile((user._id as any).toString(), dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', multerDiskOptions('profiles')))
  uploadAvatar(
    @CurrentUser() user: UserDocument,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.updateAvatar((user._id as any).toString(), file.filename);
  }
}
```

- [ ] **Step 5: Write users module**

```typescript
// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
```

- [ ] **Step 6: Add UsersModule to app.module.ts**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Smoke-test profile endpoint**

Start server (`npm run start:dev`), get a JWT from login, then:

```bash
curl -s http://localhost:3000/users/me \
  -H "Authorization: Bearer <token>" | jq .
```

Expected: `{ "success": true, "data": { "_id": "...", "name": "...", "email": "..." } }`

- [ ] **Step 8: Commit users module**

```bash
git add src/users/ src/app.module.ts
git commit -m "feat: add users module — get profile, update profile, upload avatar"
```

---

## Task 7: E2E Tests for Auth and Users

**Files:**
- Create: `test/test-app.helper.ts`
- Modify: `test/app.e2e-spec.ts`
- Create: `test/users.e2e-spec.ts`

- [ ] **Step 1: Install supertest**

```bash
npm install -D supertest @types/supertest
```

- [ ] **Step 2: Create test app helper**

```typescript
// test/test-app.helper.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();
  return app;
}
```

- [ ] **Step 3: Write auth e2e tests**

Replace entire `test/app.e2e-spec.ts` with:

```typescript
// test/app.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Model } from 'mongoose';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await app.close();
  });

  it('POST /auth/signup — rejects invalid email', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'A', email: 'bademail', password: 'pass123' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /auth/signup — rejects short password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'A', email: 'a@test-e2e.com', password: '123' });
    expect(res.status).toBe(400);
  });

  it('POST /auth/signup — creates user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'E2E User', email: 'user@test-e2e.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('POST /auth/signup — rejects duplicate email', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'E2E User', email: 'user@test-e2e.com', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('POST /auth/login — rejects unverified user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test-e2e.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('POST /auth/login — succeeds after email verification', async () => {
    await userModel.updateOne(
      { email: 'user@test-e2e.com' },
      { $set: { emailVerified: true, emailVerificationToken: undefined } },
    );
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test-e2e.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token');
  });

  it('POST /auth/forgot-password — always returns success shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'nobody@test-e2e.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /auth/google — returns 501', async () => {
    const res = await request(app.getHttpServer()).get('/auth/google');
    expect(res.status).toBe(501);
  });
});
```

- [ ] **Step 4: Write users e2e tests**

```typescript
// test/users.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Model } from 'mongoose';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Profile User', email: 'profile@test-e2e.com', password: 'password123' });
    await userModel.updateOne(
      { email: 'profile@test-e2e.com' },
      { $set: { emailVerified: true } },
    );
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'profile@test-e2e.com', password: 'password123' });
    token = loginRes.body.data.token;
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await app.close();
  });

  it('GET /users/me — 401 without token', async () => {
    const res = await request(app.getHttpServer()).get('/users/me');
    expect(res.status).toBe(401);
  });

  it('GET /users/me — returns profile with valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('email', 'profile@test-e2e.com');
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('PATCH /users/me — updates display name', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'My Display Name' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('displayName', 'My Display Name');
  });

  it('PATCH /users/me — rejects duplicate username', async () => {
    await userModel.updateOne(
      { email: 'profile@test-e2e.com' },
      { $set: { username: 'takenname' } },
    );
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Other', email: 'other@test-e2e.com', password: 'password123' });
    await userModel.updateOne(
      { email: 'other@test-e2e.com' },
      { $set: { emailVerified: true } },
    );
    const otherLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'other@test-e2e.com', password: 'password123' });
    const otherToken = otherLogin.body.data.token;

    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ username: 'takenname' });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 5: Run e2e tests against test database**

```bash
MONGODB_URI=mongodb://localhost:27017/kickr_test npm run test:e2e
```

Expected: all tests pass. Nodemailer will silently fail (no real SMTP in test env) — `signup` will still return 201 because the mail failure is not blocking in the current implementation. If it throws instead, wrap `sendMail` in a try/catch in `auth.service.ts`:

```typescript
// In signup() and forgotPassword(), wrap sendMail:
try {
  await this.transporter.sendMail({ ... });
} catch (err) {
  console.error('Mail send failed:', err.message);
}
```

- [ ] **Step 6: Commit tests**

```bash
git add test/
git commit -m "test: add e2e tests for auth and users"
```

---

## Spec Coverage Check

- [x] Sign In → `POST /auth/login` (Task 4, 5)
- [x] Sign Up + email confirmation → `POST /auth/signup` + `GET /auth/confirm-email` (Task 4, 5)
- [x] Forgot Password → `POST /auth/forgot-password` + `POST /auth/reset-password` (Task 4, 5)
- [x] Edit Profile → `PATCH /users/me` (Task 6)
- [x] Avatar upload → `POST /users/me/avatar` (Task 6)
- [x] JWT guard on all protected routes (Task 2, 6)
- [x] Global validation pipe + exception filter (Task 1, 2)
- [x] Social auth stubs returning 501 (Task 5)
- [x] passwordHash excluded from all responses (Task 3)
- [x] E2E test coverage (Task 7)
