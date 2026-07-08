# Refresh Token Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add refresh token issuance, rotation, and reuse detection to `kickr-backend`'s auth flow, so clients can renew a session without re-authenticating with credentials.

**Architecture:** Login issues both a short-lived access JWT and a longer-lived refresh JWT (separate secret/expiry). A new `POST /auth/refresh` endpoint verifies the refresh JWT, checks its embedded version against a `refreshTokenVersion` counter stored on the `User` document, and — on match — bumps the counter and issues a fresh pair. A version mismatch (replay of an already-rotated-out token) is rejected with 401.

**Tech Stack:** NestJS 11, `@nestjs/jwt`, Mongoose, Jest + `@nestjs/testing` (this repo currently has zero `.spec.ts` files — this plan introduces the first ones, following the `testRegex: ".*\.spec\.ts$"` / `rootDir: src` config already in `package.json`).

---

## File Structure

- **Modify** `src/users/schemas/user.schema.ts` — add `refreshTokenVersion` field, exclude it from `toJSON`.
- **Create** `src/auth/dto/refresh-token.dto.ts` — request body DTO for `POST /auth/refresh`.
- **Modify** `src/auth/auth.service.ts` — extract `issueTokens(user)` helper, reuse in `login`, add `refreshTokens(dto)`.
- **Modify** `src/auth/auth.controller.ts` — add `POST /auth/refresh` route.
- **Create** `src/auth/auth.service.spec.ts` — unit tests for `login`'s token pair and `refreshTokens`.
- **Create** `src/auth/auth.controller.spec.ts` — unit test confirming the new route delegates correctly.
- No changes to `auth.module.ts` — the existing single `JwtService` is reused with per-call `{ secret, expiresIn }` overrides, which `@nestjs/jwt` v11's `JwtService.sign`/`verify` support natively.

---

## Task 1: Add `refreshTokenVersion` to the User schema

**Files:**
- Modify: `src/users/schemas/user.schema.ts`

- [ ] **Step 1: Add the field**

In `src/users/schemas/user.schema.ts`, add this property to the `User` class, right after `passwordResetExpiry`:

```ts
  @Prop({ default: 0 })
  refreshTokenVersion: number;
```

- [ ] **Step 2: Exclude it from `toJSON` output**

Update the `toJSON` transform at the bottom of the same file so the field never leaks into API responses:

```ts
UserSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    const record = ret as unknown as Record<string, unknown>;
    delete record['passwordHash'];
    delete record['emailVerificationToken'];
    delete record['passwordResetToken'];
    delete record['passwordResetExpiry'];
    delete record['refreshTokenVersion'];
    return record;
  },
});
```

- [ ] **Step 3: Verify the project still builds**

Run: `npm run build`
Expected: exits with code 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/users/schemas/user.schema.ts
git commit -m "feat: add refreshTokenVersion field to User schema"
```

---

## Task 2: Add `RefreshTokenDto`

**Files:**
- Create: `src/auth/dto/refresh-token.dto.ts`

- [ ] **Step 1: Create the DTO**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/auth/dto/refresh-token.dto.ts
git commit -m "feat: add RefreshTokenDto"
```

---

## Task 3: Refactor `AuthService.login` to use a shared `issueTokens` helper

This task only refactors — no behavior change yet — so it's safe to land before the new refresh logic exists. It also gives us a stable seam to test in Task 4.

**Files:**
- Modify: `src/auth/auth.service.ts`
- Test: `src/auth/auth.service.spec.ts` (created here, extended in Task 4)

- [ ] **Step 1: Write the failing test**

Create `src/auth/auth.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from '../users/schemas/user.schema';

describe('AuthService', () => {
  let service: AuthService;
  let userModel: any;
  let jwtService: JwtService;

  const mockUser = {
    _id: 'user-id-123',
    email: 'test@example.com',
    passwordHash: '',
    refreshTokenVersion: 0,
    save: jest.fn(),
    toJSON: jest.fn().mockReturnValue({ _id: 'user-id-123', email: 'test@example.com' }),
  };

  beforeEach(async () => {
    mockUser.passwordHash = await bcrypt.hash('correct-password', 10);

    userModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
    };

    const config: Record<string, string> = {
      JWT_SECRET: 'access-secret',
      JWT_EXPIRES_IN: '60m',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_REFRESH_EXPIRES_IN: '30d',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn((payload, opts) => `signed:${JSON.stringify(payload)}:${opts?.expiresIn ?? 'default'}`),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('login', () => {
    it('returns an access token and a refresh token signed with separate secrets', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      const result = await service.login({ email: 'test@example.com', password: 'correct-password' });

      expect(result.token).toBe('signed:{"sub":"user-id-123"}:60m');
      expect(result.refreshToken).toBe(
        'signed:{"sub":"user-id-123","ver":0}:30d',
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-id-123' },
        { expiresIn: '60m' },
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-id-123', ver: 0 },
        { secret: 'refresh-secret', expiresIn: '30d' },
      );
    });

    it('throws UnauthorizedException for wrong password', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- auth.service.spec.ts`
Expected: FAIL — `result.refreshToken` is `undefined` because `login` doesn't return a `refreshToken` yet, and the `sign` call assertions for the refresh token don't match.

- [ ] **Step 3: Implement `issueTokens` and update `login`**

In `src/auth/auth.service.ts`, add a private helper and update `login` to use it:

```ts
  private issueTokens(user: UserDocument) {
    const userId = (user._id as any).toString();
    const token = this.jwtService.sign(
      { sub: userId },
      { expiresIn: this.config.get('JWT_EXPIRES_IN') },
    );
    const refreshToken = this.jwtService.sign(
      { sub: userId, ver: user.refreshTokenVersion },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
      },
    );
    return { token, refreshToken };
  }
```

Update `login` to call it:

```ts
  async login(dto: LoginDto) {
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase() })
      .select('-emailVerificationToken -passwordResetToken -passwordResetExpiry');

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    const { token, refreshToken } = this.issueTokens(user);
    // Use toJSON() to strip passwordHash for the returned user
    return { token, refreshToken, user: (user as any).toJSON() };
  }
```

Note: `user.refreshTokenVersion` must be present on the document returned by `findOne(...).select(...)`. Since `select()` here uses an exclusion list (`-emailVerificationToken ...`), `refreshTokenVersion` is included by default — no change needed to the projection.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- auth.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat: issue refresh token on login via shared issueTokens helper"
```

---

## Task 4: Implement `AuthService.refreshTokens`

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/auth.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `src/auth/auth.service.spec.ts`, inside the outer `describe('AuthService', ...)`, alongside the existing `describe('login', ...)`:

```ts
  describe('refreshTokens', () => {
    const validPayload = { sub: 'user-id-123', ver: 0 };

    it('rotates a valid refresh token and bumps the stored version', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(validPayload);
      const userForRefresh = { ...mockUser, refreshTokenVersion: 0, save: jest.fn() };
      userModel.findById.mockResolvedValue(userForRefresh);

      const result = await service.refreshTokens({ refreshToken: 'old-refresh-token' });

      expect(jwtService.verify).toHaveBeenCalledWith('old-refresh-token', {
        secret: 'refresh-secret',
      });
      expect(userForRefresh.refreshTokenVersion).toBe(1);
      expect(userForRefresh.save).toHaveBeenCalled();
      expect(result.token).toBe('signed:{"sub":"user-id-123"}:60m');
      expect(result.refreshToken).toBe('signed:{"sub":"user-id-123","ver":1}:30d');
    });

    it('rejects a replayed refresh token whose version no longer matches', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(validPayload);
      const userForRefresh = { ...mockUser, refreshTokenVersion: 1, save: jest.fn() };
      userModel.findById.mockResolvedValue(userForRefresh);

      await expect(
        service.refreshTokens({ refreshToken: 'replayed-refresh-token' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(userForRefresh.save).not.toHaveBeenCalled();
    });

    it('rejects an expired or invalid refresh token', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.refreshTokens({ refreshToken: 'expired-refresh-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a refresh token for a user that no longer exists', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(validPayload);
      userModel.findById.mockResolvedValue(null);

      await expect(
        service.refreshTokens({ refreshToken: 'orphaned-refresh-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- auth.service.spec.ts`
Expected: FAIL — `service.refreshTokens is not a function`.

- [ ] **Step 3: Implement `refreshTokens`**

Add this import to the top of `src/auth/auth.service.ts` (alongside the existing DTO imports):

```ts
import { RefreshTokenDto } from './dto/refresh-token.dto';
```

Add the method to `AuthService`, after `login`:

```ts
  async refreshTokens(dto: RefreshTokenDto) {
    let payload: { sub: string; ver: number };
    try {
      payload = this.jwtService.verify(dto.refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.userModel.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    if (user.refreshTokenVersion !== payload.ver) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    user.refreshTokenVersion += 1;
    await user.save();

    return this.issueTokens(user);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- auth.service.spec.ts`
Expected: PASS (6 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat: implement refresh token rotation with reuse detection"
```

---

## Task 5: Add `POST /auth/refresh` endpoint

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Create: `src/auth/auth.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/auth/auth.controller.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            signup: jest.fn(),
            confirmEmail: jest.fn(),
            login: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            refreshTokens: jest.fn().mockResolvedValue({
              token: 'new-access-token',
              refreshToken: 'new-refresh-token',
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  describe('refresh', () => {
    it('delegates to authService.refreshTokens and returns its result', async () => {
      const dto = { refreshToken: 'some-refresh-token' };

      const result = await controller.refresh(dto);

      expect(authService.refreshTokens).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- auth.controller.spec.ts`
Expected: FAIL — `controller.refresh is not a function`.

- [ ] **Step 3: Implement the route**

In `src/auth/auth.controller.ts`, add the import:

```ts
import { RefreshTokenDto } from './dto/refresh-token.dto';
```

Add the route handler, after `resetPassword`:

```ts
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- auth.controller.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all suites pass (`auth.service.spec.ts`, `auth.controller.spec.ts`).

- [ ] **Step 6: Verify the project builds**

Run: `npm run build`
Expected: exits with code 0.

- [ ] **Step 7: Commit**

```bash
git add src/auth/auth.controller.ts src/auth/auth.controller.spec.ts
git commit -m "feat: add POST /auth/refresh endpoint"
```

---

## Task 6: Document the new env vars

**Files:**
- Modify: `README.md` (if it documents env vars — check first) or wherever `JWT_SECRET`/`JWT_EXPIRES_IN` are currently documented.

- [ ] **Step 1: Find where existing JWT env vars are documented**

Run: `grep -rn "JWT_SECRET\|JWT_EXPIRES_IN" README.md .env.example 2>/dev/null`

- [ ] **Step 2: Add the two new env vars alongside them**

Wherever `JWT_SECRET` and `JWT_EXPIRES_IN` are listed (README table, `.env.example`, etc.), add:

```
JWT_REFRESH_SECRET=       # secret used to sign refresh tokens (must differ from JWT_SECRET)
JWT_REFRESH_EXPIRES_IN=30d
```

If no such documentation exists anywhere in the repo, skip this task — don't invent a new docs file for it.

- [ ] **Step 3: Commit (only if a file was changed)**

```bash
git add -A
git commit -m "docs: document JWT_REFRESH_SECRET and JWT_REFRESH_EXPIRES_IN"
```

---

## Self-Review Notes

- **Spec coverage:** login returns both tokens (Task 3), `/auth/refresh` rotates + detects reuse (Task 4, 5), generic 401 for every failure mode (Task 4 — all four branches throw the same `UnauthorizedException('Invalid refresh token')`), `refreshTokenVersion` hidden from API responses (Task 1), new env vars (Task 6). Logout, per-device tracking, and cookie transport are explicitly out of scope per the spec and have no tasks here.
- **Type consistency:** `refreshTokens(dto: RefreshTokenDto)` in the service (Task 4) matches the controller's `refresh(@Body() dto: RefreshTokenDto)` (Task 5). The `issueTokens(user: UserDocument)` signature from Task 3 is reused unchanged in Task 4.
- **No placeholders:** every step has literal code, exact file paths, and exact `npm test -- <file>` commands with expected pass/fail outcomes.
