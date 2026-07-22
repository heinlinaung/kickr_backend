# Cognito Auth Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom bcrypt + self-signed-JWT + nodemailer auth with AWS Cognito as the identity provider, keeping the existing `/auth/*` REST contract (backend proxies to Cognito) and verifying Cognito tokens via JWKS on protected routes.

**Architecture:** The NestJS backend calls Cognito (AWS SDK v3, `cognito-idp`) for registration, email confirmation, login, forgot/reset password, and token refresh. Cognito owns credentials and email verification. The Mongo `users` collection stores only profile data, keyed by the Cognito `sub`. Protected routes validate Cognito RS256 access tokens against the pool's JWKS endpoint (via a Passport JWT strategy configured with `jwks-rsa`), then upsert/load the local Mongo user by `cognitoSub`.

**Tech Stack:** NestJS 11 · MongoDB (Mongoose) · `@aws-sdk/client-cognito-identity-provider` (SDK v3) · `passport-jwt` + `jwks-rsa` · Cognito User Pool (username sign-in, app client **with** secret → `SECRET_HASH` required; login flow `ADMIN_USER_PASSWORD_AUTH`).

---

## Cognito environment (facts)

- Region: `ap-southeast-1`
- User Pool ID: `ap-southeast-1_0RV7oK5Z3`
- App Client ID: `5heoi44orhmv00sgm29hngepk9`
- App Client **has a secret** → every Cognito call that takes a client must send `SECRET_HASH = Base64(HMAC_SHA256(username + clientId, clientSecret))`.
- **Sign-in identifier: username.** Signup passes `Username` + `password` + an `email` attribute. Confirmation and login key off `Username`.
- Login uses **`ADMIN_USER_PASSWORD_AUTH`** (server-side admin flow, works with a client secret). **Precondition:** the app client must have `ALLOW_ADMIN_USER_PASSWORD_AUTH` enabled (Cognito console → App client → Authentication flows). If it is not enabled, login returns `InvalidParameterException` / `NotAuthorizedException` at runtime — enable it before running Task 6's manual check.
- Access tokens (used for API auth) are RS256, verified against `https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_0RV7oK5Z3/.well-known/jwks.json`. The access-token claim identifying the user is `sub` (Cognito UUID) and `username`.

**Secrets never go in git.** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `COGNITO_CLIENT_SECRET` live only in `.env` (gitignored). `.env.example` gets placeholder keys only. The client secret the user pasted in chat should be **rotated** before production — note this in the PR body, do not commit it anywhere.

---

## File Structure

**Create:**
- `src/auth/cognito/cognito.service.ts` — thin wrapper around the SDK v3 `CognitoIdentityProviderClient`; one method per Cognito operation (signUp, confirmSignUp, resendConfirmation, adminInitiateAuth, forgotPassword, confirmForgotPassword, refresh). Owns `SECRET_HASH` computation. No Nest HTTP concerns.
- `src/auth/cognito/cognito.errors.ts` — maps Cognito SDK error `name`s to Nest `HttpException`s (e.g. `UsernameExistsException` → 409, `NotAuthorizedException` → 401, `CodeMismatchException` → 400, `UserNotConfirmedException` → 403).
- `src/auth/dto/confirm-signup.dto.ts`, `src/auth/dto/resend-confirmation.dto.ts` — new request DTOs.
- `test/auth-cognito.e2e-spec.ts` — e2e with the Cognito client mocked (via `aws-sdk-client-mock`).
- `src/auth/cognito/cognito.service.spec.ts` — unit tests for `SECRET_HASH` + error mapping (mocked client).

**Modify:**
- `package.json` — add `@aws-sdk/client-cognito-identity-provider`, `jwks-rsa`; add `aws-sdk-client-mock` to devDeps. Remove `bcrypt`/`@types/bcrypt` only in the final cleanup task (Task 10), not before.
- `src/auth/auth.service.ts` — rewrite all methods to delegate to `CognitoService`; keep local-user upsert-by-`cognitoSub`.
- `src/auth/auth.controller.ts` — add `confirm-signup` + `resend-confirmation`; adapt `confirm-email` semantics; keep other routes.
- `src/auth/auth.module.ts` — drop `JwtModule` signing config; provide `CognitoService`; keep `MongooseModule` User; JwtStrategy now uses `jwks-rsa`.
- `src/auth/strategies/jwt.strategy.ts` — verify Cognito RS256 tokens via JWKS; look up Mongo user by `cognitoSub`.
- `src/auth/dto/signup.dto.ts` — add `username` (sign-in id) alongside `name`/`email`/`password`.
- `src/auth/dto/login.dto.ts` — key on `username` + `password` (was email + password).
- `src/auth/dto/reset-password.dto.ts` — Cognito reset needs `username` + `code` + `newPassword`.
- `src/users/schemas/user.schema.ts` — add `cognitoSub` (unique, indexed); remove `passwordHash`, `emailVerificationToken`, `passwordResetToken`, `passwordResetExpiry`, `refreshTokenVersion` (Cognito owns these). Keep `USER_SENSITIVE_PROJECTION` but update its contents.
- `.env.example` — add Cognito/AWS keys; remove `JWT_SECRET`/`JWT_REFRESH_*`/`MAIL_*` only in Task 10 cleanup.
- `README.md` — auth section rewrite (Task 10).

**Delete (Task 10, after everything green):**
- `src/auth/dto/refresh-token.dto.ts` is **kept** (refresh still takes a refresh token, now Cognito's).
- Remove `bcrypt`, `nodemailer`, `uuid`, `@nestjs/jwt` signing usage from auth. (`@nestjs/jwt` may stay if nothing else needs it — confirm via grep in Task 10.)

---

## Task 1: Add dependencies and Cognito env config

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.env` (local only, not committed — user fills secrets)

- [ ] **Step 1: Install runtime + dev dependencies**

Run:
```bash
cd "$(git rev-parse --show-toplevel)"
npm install @aws-sdk/client-cognito-identity-provider jwks-rsa
npm install -D aws-sdk-client-mock
```
Expected: `package.json` gains the two runtime deps and one devDep; `package-lock.json` updates; exit 0.

- [ ] **Step 2: Add Cognito keys to `.env.example`** (placeholders only — no real values)

Add these lines to `.env.example`:
```env
# AWS Cognito
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your_iam_access_key
AWS_SECRET_ACCESS_KEY=your_iam_secret_key
COGNITO_USER_POOL_ID=ap-southeast-1_0RV7oK5Z3
COGNITO_CLIENT_ID=5heoi44orhmv00sgm29hngepk9
COGNITO_CLIENT_SECRET=your_app_client_secret
```

- [ ] **Step 3: Add the same keys with real values to `.env`** (local file, gitignored)

Set `AWS_REGION`, `COGNITO_USER_POOL_ID=ap-southeast-1_0RV7oK5Z3`, `COGNITO_CLIENT_ID=5heoi44orhmv00sgm29hngepk9` and fill `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `COGNITO_CLIENT_SECRET` with your real values. Confirm `.env` is in `.gitignore`:

Run: `git check-ignore .env`
Expected: prints `.env` (meaning it is ignored).

- [ ] **Step 4: Verify build still compiles**

Run: `npm run build`
Expected: exit 0, no TS errors (no code uses the new deps yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(auth): add Cognito SDK v3 + jwks-rsa deps and env keys"
```

---

## Task 2: Add `cognitoSub` to User schema, remove credential fields

**Files:**
- Modify: `src/users/schemas/user.schema.ts`
- Test: `src/users/schemas/user.schema.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/users/schemas/user.schema.spec.ts`:
```ts
import { UserSchema, USER_SENSITIVE_PROJECTION } from './user.schema';

describe('User schema (Cognito migration)', () => {
  it('has a cognitoSub path and no passwordHash path', () => {
    const paths = Object.keys(UserSchema.paths);
    expect(paths).toContain('cognitoSub');
    expect(paths).not.toContain('passwordHash');
    expect(paths).not.toContain('refreshTokenVersion');
  });

  it('sensitive projection no longer references removed fields', () => {
    expect(USER_SENSITIVE_PROJECTION).not.toContain('passwordResetToken');
    expect(USER_SENSITIVE_PROJECTION).not.toContain('emailVerificationToken');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/users/schemas/user.schema.spec.ts`
Expected: FAIL — `cognitoSub` not in paths / `passwordHash` still present.

- [ ] **Step 3: Edit the schema**

In `src/users/schemas/user.schema.ts`:
- Add prop:
```ts
  @Prop({ required: true, unique: true, index: true })
  cognitoSub: string;
```
- Remove the `@Prop` declarations for `passwordHash`, `emailVerificationToken`, `passwordResetToken`, `passwordResetExpiry`, and `refreshTokenVersion`.
- Update `USER_SENSITIVE_PROJECTION` so it no longer names the removed fields. If nothing sensitive remains to hide, set:
```ts
export const USER_SENSITIVE_PROJECTION = '-__v';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/users/schemas/user.schema.spec.ts`
Expected: PASS.

- [ ] **Step 5: Verify the whole project still type-checks** (expect auth.service to break next — that's fine, we fix it in Task 5; if build fails only inside `src/auth/**`, proceed)

Run: `npm run build 2>&1 | grep -v 'src/auth/' | grep 'error TS' || echo "no non-auth type errors"`
Expected: prints `no non-auth type errors`.

- [ ] **Step 6: Commit**

```bash
git add src/users/schemas/user.schema.ts src/users/schemas/user.schema.spec.ts
git commit -m "feat(users): key users on cognitoSub, drop credential fields"
```

---

## Task 3: CognitoService — SECRET_HASH helper (unit-tested first)

**Files:**
- Create: `src/auth/cognito/cognito.service.ts`
- Test: `src/auth/cognito/cognito.service.spec.ts`

- [ ] **Step 1: Write the failing test for SECRET_HASH**

Create `src/auth/cognito/cognito.service.spec.ts`:
```ts
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { CognitoService } from './cognito.service';

function expectedHash(username: string, clientId: string, secret: string) {
  return createHmac('sha256', secret)
    .update(username + clientId)
    .digest('base64');
}

describe('CognitoService.secretHash', () => {
  const config = {
    get: (k: string) =>
      ({
        AWS_REGION: 'ap-southeast-1',
        COGNITO_USER_POOL_ID: 'ap-southeast-1_0RV7oK5Z3',
        COGNITO_CLIENT_ID: 'client123',
        COGNITO_CLIENT_SECRET: 'secret456',
      })[k],
  } as unknown as ConfigService;

  it('computes the Cognito SECRET_HASH for a username', () => {
    const svc = new CognitoService(config);
    // secretHash is private; test via bracket access
    const hash = (svc as any).secretHash('alice');
    expect(hash).toBe(expectedHash('alice', 'client123', 'secret456'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/auth/cognito/cognito.service.spec.ts`
Expected: FAIL — cannot find module `./cognito.service`.

- [ ] **Step 3: Create the service with client + secretHash**

Create `src/auth/cognito/cognito.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import {
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

@Injectable()
export class CognitoService {
  private readonly client: CognitoIdentityProviderClient;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly userPoolId: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('AWS_REGION') as string;
    this.client = new CognitoIdentityProviderClient({ region });
    this.clientId = this.config.get<string>('COGNITO_CLIENT_ID') as string;
    this.clientSecret = this.config.get<string>(
      'COGNITO_CLIENT_SECRET',
    ) as string;
    this.userPoolId = this.config.get<string>(
      'COGNITO_USER_POOL_ID',
    ) as string;
  }

  private secretHash(username: string): string {
    return createHmac('sha256', this.clientSecret)
      .update(username + this.clientId)
      .digest('base64');
  }
}
```
(The AWS client uses the default credential provider chain, so `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from `.env` are picked up automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/auth/cognito/cognito.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/cognito/cognito.service.ts src/auth/cognito/cognito.service.spec.ts
git commit -m "feat(auth): CognitoService scaffold with SECRET_HASH helper"
```

---

## Task 4: CognitoService — operations + error mapping

**Files:**
- Create: `src/auth/cognito/cognito.errors.ts`
- Modify: `src/auth/cognito/cognito.service.ts`
- Modify: `src/auth/cognito/cognito.service.spec.ts`

- [ ] **Step 1: Write the failing test for signUp + error mapping (mocked client)**

Append to `src/auth/cognito/cognito.service.spec.ts`:
```ts
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ConflictException } from '@nestjs/common';

describe('CognitoService.signUp', () => {
  const config = {
    get: (k: string) =>
      ({
        AWS_REGION: 'ap-southeast-1',
        COGNITO_CLIENT_ID: 'client123',
        COGNITO_CLIENT_SECRET: 'secret456',
        COGNITO_USER_POOL_ID: 'pool',
      })[k],
  } as unknown as ConfigService;
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  beforeEach(() => cognitoMock.reset());

  it('returns the Cognito sub on success', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-123' });
    const svc = new CognitoService(config);
    const sub = await svc.signUp('alice', 'p@ssw0rd', 'a@b.com');
    expect(sub).toBe('sub-123');
  });

  it('maps UsernameExistsException to 409', async () => {
    const err: any = new Error('exists');
    err.name = 'UsernameExistsException';
    cognitoMock.on(SignUpCommand).rejects(err);
    const svc = new CognitoService(config);
    await expect(svc.signUp('alice', 'p', 'a@b.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/auth/cognito/cognito.service.spec.ts`
Expected: FAIL — `svc.signUp` is not a function.

- [ ] **Step 3: Create the error mapper**

Create `src/auth/cognito/cognito.errors.ts`:
```ts
import {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export function mapCognitoError(err: unknown): HttpException {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? 'Auth error';
  switch (name) {
    case 'UsernameExistsException':
      return new ConflictException('Username already registered');
    case 'NotAuthorizedException':
      return new UnauthorizedException('Invalid credentials');
    case 'UserNotConfirmedException':
      return new ForbiddenException('Account not confirmed');
    case 'UserNotFoundException':
      return new NotFoundException('User not found');
    case 'CodeMismatchException':
    case 'ExpiredCodeException':
      return new BadRequestException('Invalid or expired code');
    case 'InvalidPasswordException':
    case 'InvalidParameterException':
      return new BadRequestException(message);
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return new ServiceUnavailableException('Too many attempts, retry later');
    default:
      return new BadRequestException(message);
  }
}
```

- [ ] **Step 4: Add operation methods to `CognitoService`**

In `src/auth/cognito/cognito.service.ts`, import the commands and add methods. Full additions:
```ts
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  AdminInitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { mapCognitoError } from './cognito.errors';

// inside the class:

  async signUp(username: string, password: string, email: string): Promise<string> {
    try {
      const res = await this.client.send(
        new SignUpCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
          Password: password,
          UserAttributes: [{ Name: 'email', Value: email }],
        }),
      );
      return res.UserSub as string;
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async confirmSignUp(username: string, code: string): Promise<void> {
    try {
      await this.client.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
          ConfirmationCode: code,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async resendConfirmation(username: string): Promise<void> {
    try {
      await this.client.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async login(username: string, password: string) {
    try {
      const res = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
          AuthParameters: {
            USERNAME: username,
            PASSWORD: password,
            SECRET_HASH: this.secretHash(username),
          },
        }),
      );
      const r = res.AuthenticationResult;
      return {
        accessToken: r?.AccessToken as string,
        idToken: r?.IdToken as string,
        refreshToken: r?.RefreshToken as string,
        expiresIn: r?.ExpiresIn,
      };
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async refresh(username: string, refreshToken: string) {
    try {
      const res = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
            SECRET_HASH: this.secretHash(username),
          },
        }),
      );
      const r = res.AuthenticationResult;
      return {
        accessToken: r?.AccessToken as string,
        idToken: r?.IdToken as string,
        expiresIn: r?.ExpiresIn,
      };
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async forgotPassword(username: string): Promise<void> {
    try {
      await this.client.send(
        new ForgotPasswordCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async confirmForgotPassword(username: string, code: string, newPassword: string): Promise<void> {
    try {
      await this.client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
          ConfirmationCode: code,
          Password: newPassword,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }
```

> Note on refresh: Cognito's `REFRESH_TOKEN_AUTH` still requires `SECRET_HASH` computed from the **username** (not the token). The client must send its username with the refresh request — reflected in the refresh DTO (Task 7).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/auth/cognito/cognito.service.spec.ts`
Expected: PASS (both success and 409-mapping tests).

- [ ] **Step 6: Commit**

```bash
git add src/auth/cognito/
git commit -m "feat(auth): Cognito operations (signup/confirm/login/refresh/reset) + error mapping"
```

---

## Task 5: Rewrite AuthService to proxy Cognito + upsert Mongo profile

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/dto/signup.dto.ts`
- Modify: `src/auth/dto/login.dto.ts`
- Modify: `src/auth/dto/reset-password.dto.ts`
- Modify: `src/auth/dto/refresh-token.dto.ts`
- Create: `src/auth/dto/confirm-signup.dto.ts`
- Create: `src/auth/dto/resend-confirmation.dto.ts`
- Test: `src/auth/auth.service.spec.ts` (replace existing)

- [ ] **Step 1: Update DTOs**

`src/auth/dto/signup.dto.ts` — add `username`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, Matches } from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'alice', minLength: 3 })
  @IsString()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username has invalid characters' })
  username: string;

  @ApiProperty({ example: 'John Doe', minLength: 2 })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
```

`src/auth/dto/login.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  username: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(1)
  password: string;
}
```

`src/auth/dto/reset-password.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  username: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  code: string;

  @ApiProperty({ example: 'NewPassword123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
```

`src/auth/dto/refresh-token.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  username: string;

  @ApiProperty()
  @IsString()
  refreshToken: string;
}
```

Create `src/auth/dto/confirm-signup.dto.ts`:
```ts
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
```

Create `src/auth/dto/resend-confirmation.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ResendConfirmationDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  username: string;
}
```

- [ ] **Step 2: Write the failing AuthService test** (replace `src/auth/auth.service.spec.ts` entirely)

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { CognitoService } from './cognito/cognito.service';
import { User } from '../users/schemas/user.schema';

describe('AuthService (Cognito proxy)', () => {
  let service: AuthService;
  const cognito = {
    signUp: jest.fn(),
    confirmSignUp: jest.fn(),
    resendConfirmation: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    forgotPassword: jest.fn(),
    confirmForgotPassword: jest.fn(),
  };
  const userModel = {
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: CognitoService, useValue: cognito },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('signup: creates Cognito user then local profile keyed by sub', async () => {
    cognito.signUp.mockResolvedValue('sub-abc');
    userModel.create.mockResolvedValue({});
    const res = await service.signup({
      username: 'alice',
      name: 'Alice',
      email: 'a@b.com',
      password: 'Password123!',
    } as any);
    expect(cognito.signUp).toHaveBeenCalledWith('alice', 'Password123!', 'a@b.com');
    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ cognitoSub: 'sub-abc', username: 'alice', email: 'a@b.com', name: 'Alice' }),
    );
    expect(res.message).toMatch(/confirm/i);
  });

  it('login: returns Cognito tokens', async () => {
    cognito.login.mockResolvedValue({
      accessToken: 'at', idToken: 'it', refreshToken: 'rt', expiresIn: 3600,
    });
    const res = await service.login({ username: 'alice', password: 'p' } as any);
    expect(res).toEqual(
      expect.objectContaining({ accessToken: 'at', refreshToken: 'rt' }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/auth/auth.service.spec.ts`
Expected: FAIL — AuthService still references bcrypt/jwt and the old signatures.

- [ ] **Step 4: Rewrite `src/auth/auth.service.ts`**

Replace the entire file with:
```ts
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
    const sub = await this.cognito.signUp(dto.username, dto.password, dto.email);
    await this.userModel.create({
      cognitoSub: sub,
      username: dto.username,
      name: dto.name,
      email: dto.email.toLowerCase(),
    });
    return { message: 'Signup successful. Check your email to confirm your account.' };
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
    await this.cognito.confirmForgotPassword(dto.username, dto.code, dto.newPassword);
    return { message: 'Password reset successful. You can now log in.' };
  }
}
```

> `ForgotPasswordDto` currently keys on `email`. Update `src/auth/dto/forgot-password.dto.ts` to use `username` (string) instead of email, matching Cognito. If the field stays named `email` it will break — rename to `username`.

- [ ] **Step 5: Update `src/auth/dto/forgot-password.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  username: string;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest src/auth/auth.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts src/auth/dto/
git commit -m "feat(auth): proxy AuthService to Cognito, upsert profile by cognitoSub"
```

---

## Task 6: Update controller routes

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Test: `src/auth/auth.controller.spec.ts` (update)

- [ ] **Step 1: Rewrite the controller**

Replace `src/auth/auth.controller.ts`:
```ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ConfirmSignupDto } from './dto/confirm-signup.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';

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
}
```
(Google/Facebook stubs removed — they were 501 placeholders and are out of scope; note in PR.)

- [ ] **Step 2: Update `src/auth/auth.controller.spec.ts`**

Ensure the test provides a mock `AuthService` with `signup/confirmSignup/resendConfirmation/login/forgotPassword/resetPassword/refreshTokens` and asserts each route delegates. Minimal shape:
```ts
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    signup: jest.fn().mockResolvedValue({ message: 'ok' }),
    confirmSignup: jest.fn(),
    resendConfirmation: jest.fn(),
    login: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    refreshTokens: jest.fn(),
  };
  beforeEach(async () => {
    const m = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = m.get(AuthController);
  });
  it('signup delegates to service', async () => {
    await controller.signup({ username: 'a', name: 'A', email: 'a@b.com', password: 'Password123!' } as any);
    expect(authService.signup).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx jest src/auth/auth.controller.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/auth/auth.controller.ts src/auth/auth.controller.spec.ts
git commit -m "feat(auth): Cognito auth routes (confirm-signup, resend-confirmation)"
```

---

## Task 7: JWKS verification strategy + module wiring

**Files:**
- Modify: `src/auth/strategies/jwt.strategy.ts`
- Modify: `src/auth/auth.module.ts`
- Test: `src/auth/strategies/jwt.strategy.spec.ts` (create)

- [ ] **Step 1: Write the failing test for the validate() lookup**

Create `src/auth/strategies/jwt.strategy.spec.ts`:
```ts
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate (Cognito)', () => {
  const config = {
    get: (k: string) =>
      ({
        AWS_REGION: 'ap-southeast-1',
        COGNITO_USER_POOL_ID: 'ap-southeast-1_0RV7oK5Z3',
        COGNITO_CLIENT_ID: 'client123',
      })[k],
  } as unknown as ConfigService;

  it('loads the Mongo user by cognitoSub from the token claim', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'x', cognitoSub: 'sub-1' });
    const userModel = { findOne: jest.fn(() => ({ select: () => ({ lean }) })) };
    const strat = new JwtStrategy(config, userModel as any);
    const user = await strat.validate({ sub: 'sub-1', username: 'alice' });
    expect(userModel.findOne).toHaveBeenCalledWith({ cognitoSub: 'sub-1' });
    expect(user).toEqual(expect.objectContaining({ cognitoSub: 'sub-1' }));
  });

  it('rejects when no user matches', async () => {
    const lean = jest.fn().mockResolvedValue(null);
    const userModel = { findOne: jest.fn(() => ({ select: () => ({ lean }) })) };
    const strat = new JwtStrategy(config, userModel as any);
    await expect(strat.validate({ sub: 'nope', username: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/auth/strategies/jwt.strategy.spec.ts`
Expected: FAIL — current `validate` calls `findById(payload.sub)`, not `findOne({ cognitoSub })`.

- [ ] **Step 3: Rewrite the strategy to use JWKS + cognitoSub**

Replace `src/auth/strategies/jwt.strategy.ts`:
```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserDocument,
  USER_SENSITIVE_PROJECTION,
} from '../../users/schemas/user.schema';

interface CognitoAccessClaims {
  sub: string;
  username: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {
    const region = config.get<string>('AWS_REGION');
    const poolId = config.get<string>('COGNITO_USER_POOL_ID');
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      algorithms: ['RS256'],
      issuer,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${issuer}/.well-known/jwks.json`,
      }),
    });
  }

  async validate(payload: CognitoAccessClaims) {
    const user = await this.userModel
      .findOne({ cognitoSub: payload.sub })
      .select(USER_SENSITIVE_PROJECTION)
      .lean();
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

- [ ] **Step 4: Update `src/auth/auth.module.ts`**

Replace with (drops JwtModule signing, adds CognitoService):
```ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CognitoService } from './cognito/cognito.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    PassportModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, CognitoService, JwtStrategy],
  exports: [PassportModule],
})
export class AuthModule {}
```

> If `npm run build` reports other modules importing `JwtModule` from AuthModule's old export, grep for them (Task 10) — none are expected since JwtStrategy is self-contained.

- [ ] **Step 5: Run tests**

Run: `npx jest src/auth/strategies/jwt.strategy.spec.ts`
Expected: PASS.

- [ ] **Step 6: Verify full build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/auth/strategies/jwt.strategy.ts src/auth/auth.module.ts src/auth/strategies/jwt.strategy.spec.ts
git commit -m "feat(auth): verify Cognito RS256 tokens via JWKS, load user by cognitoSub"
```

---

## Task 8: e2e smoke test with mocked Cognito

**Files:**
- Create: `test/auth-cognito.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test** (mocks the Cognito client so no AWS calls happen)

Create `test/auth-cognito.e2e-spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getModelToken } from '@nestjs/mongoose';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { CognitoService } from '../src/auth/cognito/cognito.service';
import { ConfigService } from '@nestjs/config';
import { User } from '../src/users/schemas/user.schema';

describe('Auth e2e (Cognito mocked)', () => {
  let app: INestApplication;
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  const userModel = { create: jest.fn().mockResolvedValue({}), findOne: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        CognitoService,
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({
                AWS_REGION: 'ap-southeast-1',
                COGNITO_CLIENT_ID: 'client123',
                COGNITO_CLIENT_SECRET: 'secret456',
                COGNITO_USER_POOL_ID: 'pool',
              })[k],
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(() => cognitoMock.reset());
  afterAll(async () => app.close());

  it('POST /auth/signup creates cognito user + local profile', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-xyz' });
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ username: 'alice', name: 'Alice', email: 'a@b.com', password: 'Password123!' })
      .expect(201);
    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ cognitoSub: 'sub-xyz', username: 'alice' }),
    );
  });

  it('POST /auth/signup rejects short password via validation', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ username: 'a', name: 'A', email: 'bad', password: '123' })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npx jest --config ./test/jest-e2e.json test/auth-cognito.e2e-spec.ts`
Expected: PASS (both cases).

- [ ] **Step 3: Commit**

```bash
git add test/auth-cognito.e2e-spec.ts
git commit -m "test(auth): e2e signup flow with mocked Cognito client"
```

---

## Task 9: Full test + lint gate

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: all suites pass. If any non-auth suite references removed User fields (`passwordHash`, etc.), fix those references in the same task (search: `grep -rn "passwordHash\|refreshTokenVersion\|emailVerificationToken\|passwordResetToken" src test`).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: exit 0 (auto-fixes applied).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "test: fix references to removed credential fields after Cognito migration"
```

---

## Task 10: Cleanup dead auth code + docs

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Find dead usages**

Run: `grep -rn "bcrypt\|nodemailer\|JWT_SECRET\|JWT_REFRESH\|@nestjs/jwt" src`
Expected: only matches (if any) are ones you will now remove. If `@nestjs/jwt` has no remaining importers, it can be uninstalled; if something outside auth uses it, leave it.

- [ ] **Step 2: Remove unused deps** (only those with zero remaining `grep` hits in `src`)

Run (adjust to what grep showed had zero hits):
```bash
npm uninstall bcrypt @types/bcrypt
```
Leave `nodemailer`/`@nestjs/jwt`/`uuid` installed only if still referenced elsewhere; otherwise uninstall them too.

- [ ] **Step 3: Prune obsolete env keys from `.env.example`**

Remove `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, and the `MAIL_*` block **if** no code references them (per Step 1 grep). Keep `MONGODB_URI`, `PORT`, `NODE_ENV`, `APP_BASE_URL`, `UPLOADS_DIR`, and the Cognito block.

- [ ] **Step 4: Update README auth section**

In `README.md`, replace the "Auth" feature bullet and any JWT/email config docs with: Cognito-backed auth (username sign-in), the new route list (`/auth/signup`, `/auth/confirm-signup`, `/auth/resend-confirmation`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/refresh`), the required env keys, and a one-line note that protected routes expect a Cognito **access token** as `Authorization: Bearer`.

- [ ] **Step 5: Full gate again**

Run: `npm run build && npm test`
Expected: exit 0, all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(auth): remove bcrypt/JWT-signing/email dead code, update docs for Cognito"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** register+verify (Tasks 3–6), login/token issuance (Tasks 4–6 via Cognito tokens), forgot/reset (Tasks 4–5), refresh (Tasks 4–5), identity/profile split by `cognitoSub` (Task 2, 5), JWKS verification on protected routes (Task 7). All four requested Cognito scopes covered.
- **Type consistency:** `signUp(username,password,email)→sub`, `login()→{accessToken,idToken,refreshToken,expiresIn}`, `refresh(username,refreshToken)`, `validate({sub,username})→user by `cognitoSub`` — signatures match across service, auth-service, strategy, and tests.
- **Manual precondition (cannot be unit-tested):** login requires `ALLOW_ADMIN_USER_PASSWORD_AUTH` on the app client. Verify in console before a real login smoke test. All automated tests mock Cognito, so they pass regardless; a live login is the only thing that exercises this flag.
- **Security:** the client secret pasted in chat is treated as compromised — rotate it; the plan never commits it (only `.env`).

---

## Open follow-ups (out of scope for this plan)

- Migrating existing Mongo users (with `passwordHash`) into Cognito — this plan assumes a fresh pool / no legacy users to migrate. If legacy users exist, a separate bulk `AdminCreateUser` migration plan is needed.
- Google/Facebook social login via Cognito identity providers (the old 501 stubs are removed).
- Whether the Flutter app should store/send the Cognito **access** token (used here for API auth) vs the id token — coordinate with mobile.
```
