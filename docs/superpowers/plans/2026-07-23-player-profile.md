# Player Profile (§4.2 / §4.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `User` profile to the spec's Player Profile (§4.2) + User Management (§4.1) fields — biography, country, city, dateOfBirth, sports[], preferredSport, footballPosition, privacy settings — make them editable via `PATCH /users/me`, add a QR/invite-link identity (`inviteCode` + `GET /users/me/qr`), a privacy-respecting public profile (`GET /users/:id/profile`) that assembles match history from existing event data, and a statistics block that is computed where possible today and cleanly stubbed where it depends on unbuilt work (after-match results §4.5, ratings §4.10).

**Architecture:** Additive schema fields (no removals). `updateProfile` already does `$set: dto`, and the global ValidationPipe runs `whitelist: true, forbidNonWhitelisted: true`, so the **DTO is the write-whitelist** — new editable fields are added to `UpdateProfileDto`, and identity fields (`cognitoSub`, `email`, `emailVerified`, `inviteCode`) are deliberately NOT in it so they can never be set by the client. Public profile assembles: base fields (filtered by the owner's privacy settings) + match history (join `EventPlayer` → `Event` for events the user joined) + a statistics object (matchesPlayed computed now; wins/mvpCount/avgRating stubbed to 0 with a documented TODO until §4.5 results + §4.10 ratings land).

**Tech Stack:** NestJS 11 · MongoDB (Mongoose) · existing EventPlayer/Event collections · `uuid` (already a dep) for inviteCode.

**File uploads:** all image uploads (avatar, and later gallery) use the **existing local-disk multer** (`multerDiskOptions` → `diskStorage` under `/uploads/...`) — no S3, no object storage. The current avatar route (`POST /users/me/avatar`) already does this and is unchanged by this plan.

---

## Design decisions (locked with product)

1. **Scope:** core fields + QR/invite link + public profile endpoint + derived data — all four.
2. **Derived stats caveat (explicit):** `matchesPlayed` and match history come from real `EventPlayer`/`Event` data today. `wins`, `mvpCount`, `avgRating`, `highlightVideos` require the Event After-Match results (§4.5, planned) and Ratings (§4.10, not planned) — these are returned as `0`/empty with a `// TODO` and wired to compute for real once those features exist. This plan does NOT fake them.
3. **Privacy:** `privacy.profileVisibility` (`public|members|private`) + `showStats` + `showMatchHistory`. Public endpoint honors them: `private` → 404/limited; `showStats:false` → omit stats; `showMatchHistory:false` → omit history. (`members` visibility is treated as `public` for now — group-membership-scoped visibility is a follow-up, noted inline.)
4. **Football position** only meaningful when `'football' ∈ sports`; not enforced at the DB layer (soft rule), validated as an enum value.

---

## Security boundary (must hold)

- `updateProfile` uses `$set: dto`. NEVER add `cognitoSub`, `email`, `emailVerified`, or `inviteCode` to `UpdateProfileDto` — they must not be client-settable. Task 6 includes an explicit test that a payload containing `cognitoSub`/`email` does NOT change those fields (the ValidationPipe strips them).
- `inviteCode` is generated server-side (Task 4), never accepted from input.
- Public profile (`GET /users/:id/profile`) must apply `USER_SENSITIVE_PROJECTION` AND privacy filtering; never leak `email`, `phoneNumber`, `cognitoSub` to other users.

---

## File Structure

**Create:**
- `src/users/profile.constants.ts` — enums: `FOOTBALL_POSITIONS`, `PROFILE_VISIBILITY`, `SPORT_TYPES`. Single source used by schema + DTO.
- `src/users/dto/public-profile.query` — (not needed; no query params) — skip.
- `src/users/users.service.spec.ts` — unit tests (updateProfile whitelist, buildPublicProfile privacy filtering, stats stub shape).
- `src/users/users.controller.spec.ts` — route delegation (qr, public profile).

**Modify:**
- `src/users/schemas/user.schema.ts` — add: `biography`, `country`, `city`, `dateOfBirth`, `sports: string[]`, `preferredSport`, `footballPosition`, `privacy` (subdoc), `inviteCode` (unique sparse), `highlightVideos: string[]` (empty; populated later), `gallery: string[]`.
- `src/users/dto/update-profile.dto.ts` — add the editable fields (NOT identity fields). Enum-validate position/visibility/sports.
- `src/users/users.service.ts` — add `ensureInviteCode`, `getQr`, `getPublicProfile`, `buildStatistics` (partial/stubbed), `getMatchHistory`.
- `src/users/users.controller.ts` — add `GET /users/me/qr`, `GET /users/:id/profile`.
- `src/users/users.module.ts` — register `EventPlayer` + `Event` models (for match history/stats joins).

**Explicitly deferred (documented):** real `wins`/`mvpCount`/`avgRating` computation (needs §4.5 + §4.10), `highlightVideos` upload transport (needs a media-upload plan), `members`-scoped visibility (needs group-membership check), achievements/gallery upload endpoint (field added; upload route is a follow-up).

---

## Task 1: Profile constants (enums)

**Files:**
- Create: `src/users/profile.constants.ts`
- Test: `src/users/profile.constants.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { FOOTBALL_POSITIONS, PROFILE_VISIBILITY, SPORT_TYPES } from './profile.constants';

describe('profile constants', () => {
  it('football positions', () => {
    expect(FOOTBALL_POSITIONS).toEqual([
      'goalkeeper', 'defender', 'midfielder', 'forward', 'playmaker',
    ]);
  });
  it('visibility', () => {
    expect(PROFILE_VISIBILITY).toEqual(['public', 'members', 'private']);
  });
  it('sports include football', () => {
    expect(SPORT_TYPES).toEqual(expect.arrayContaining(['football', 'futsal']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/users/profile.constants.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
export const FOOTBALL_POSITIONS = [
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
  'playmaker',
] as const;

export const PROFILE_VISIBILITY = ['public', 'members', 'private'] as const;

export const SPORT_TYPES = ['football', 'futsal', 'padel', 'basketball'] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/users/profile.constants.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/users/profile.constants.ts src/users/profile.constants.spec.ts
git commit -m "feat(users): profile enums (positions, visibility, sports)"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

---

## Task 2: User schema — profile fields

**Files:**
- Modify: `src/users/schemas/user.schema.ts`
- Test: `src/users/schemas/user.schema.spec.ts` (exists from the Cognito migration — extend it)

**Context:** current schema has cognitoSub, name, username, displayName, email, phoneNumber, height, weight, profileImage, emailVerified. Keep all. Add the profile fields. Do NOT change USER_SENSITIVE_PROJECTION logic beyond keeping `-__v`.

- [ ] **Step 1: Add failing assertions to `src/users/schemas/user.schema.spec.ts`**

Append a describe block:
```ts
import { UserSchema } from './user.schema';

describe('User schema (profile fields)', () => {
  it('has the new profile paths', () => {
    const paths = Object.keys(UserSchema.paths);
    expect(paths).toEqual(expect.arrayContaining([
      'biography', 'country', 'city', 'dateOfBirth',
      'sports', 'preferredSport', 'footballPosition',
      'privacy.profileVisibility', 'privacy.showStats', 'privacy.showMatchHistory',
      'inviteCode', 'highlightVideos', 'gallery',
    ]));
  });
  it('privacy defaults', () => {
    const vis: any = UserSchema.path('privacy.profileVisibility');
    expect(vis.options.default).toBe('public');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/users/schemas/user.schema.spec.ts`
Expected: FAIL — new paths absent.

- [ ] **Step 3: Edit the schema**

Add imports:
```ts
import { Types } from 'mongoose';
import { FOOTBALL_POSITIONS, PROFILE_VISIBILITY } from '../profile.constants';
```
Add these props inside the class (after `emailVerified`):
```ts
  @Prop()
  biography: string;

  @Prop()
  country: string;

  @Prop()
  city: string;

  @Prop()
  dateOfBirth: Date;

  @Prop({ type: [String], default: [] })
  sports: string[];

  @Prop()
  preferredSport: string;

  @Prop({ enum: [...FOOTBALL_POSITIONS] })
  footballPosition: string;

  @Prop({
    type: {
      profileVisibility: { type: String, enum: [...PROFILE_VISIBILITY], default: 'public' },
      showStats: { type: Boolean, default: true },
      showMatchHistory: { type: Boolean, default: true },
    },
    default: () => ({ profileVisibility: 'public', showStats: true, showMatchHistory: true }),
    _id: false,
  })
  privacy: {
    profileVisibility: string;
    showStats: boolean;
    showMatchHistory: boolean;
  };

  @Prop({ unique: true, sparse: true })
  inviteCode: string;

  @Prop({ type: [String], default: [] })
  highlightVideos: string[];

  @Prop({ type: [String], default: [] })
  gallery: string[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/users/schemas/user.schema.spec.ts`
Expected: PASS (existing cognito tests + new profile tests).

- [ ] **Step 5: Commit**

```bash
git add src/users/schemas/user.schema.ts src/users/schemas/user.schema.spec.ts
git commit -m "feat(users): add profile fields (bio, location, sports, position, privacy, invite)"
```
End with the Co-Authored-By trailer.

---

## Task 3: UpdateProfileDto — editable fields (whitelist)

**Files:**
- Modify: `src/users/dto/update-profile.dto.ts`

**CRITICAL:** add ONLY editable fields. Do NOT add cognitoSub/email/emailVerified/inviteCode — the DTO is the write-whitelist.

- [ ] **Step 1: Extend the DTO**

Add imports:
```ts
import {
  IsString, IsOptional, IsNumber, MinLength, IsArray, IsIn, IsDateString, ValidateNested, IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FOOTBALL_POSITIONS, PROFILE_VISIBILITY, SPORT_TYPES } from '../profile.constants';
```
Add a nested privacy DTO in the same file (above `UpdateProfileDto`):
```ts
class PrivacyDto {
  @ApiProperty({ enum: PROFILE_VISIBILITY, required: false })
  @IsOptional()
  @IsIn([...PROFILE_VISIBILITY])
  profileVisibility?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showStats?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showMatchHistory?: boolean;
}
```
Add these fields to `UpdateProfileDto` (keep the existing name/username/displayName/phoneNumber/height/weight):
```ts
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  biography?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false, example: '1995-06-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn([...SPORT_TYPES], { each: true })
  sports?: string[];

  @ApiProperty({ required: false, enum: SPORT_TYPES })
  @IsOptional()
  @IsIn([...SPORT_TYPES])
  preferredSport?: string;

  @ApiProperty({ required: false, enum: FOOTBALL_POSITIONS })
  @IsOptional()
  @IsIn([...FOOTBALL_POSITIONS])
  footballPosition?: string;

  @ApiProperty({ required: false, type: PrivacyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyDto)
  privacy?: PrivacyDto;
```

- [ ] **Step 2: Verify it compiles**

Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' | grep 'update-profile' || echo "dto compiles"`
Expected: `dto compiles`.

- [ ] **Step 3: Commit**

```bash
git add src/users/dto/update-profile.dto.ts
git commit -m "feat(users): editable profile fields in UpdateProfileDto (whitelist)"
```
End with the Co-Authored-By trailer.

---

## Task 4: Service — invite code + QR

**Files:**
- Modify: `src/users/users.service.ts`
- Test: `src/users/users.service.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';

describe('UsersService QR/invite', () => {
  let service: UsersService;
  const userModel: any = {};
  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();
    service = m.get(UsersService);
  });

  it('getQr generates and persists an inviteCode when absent, returns a shareable payload', async () => {
    userModel.findById = jest.fn().mockResolvedValue({ _id: 'u1', inviteCode: undefined });
    userModel.findByIdAndUpdate = jest.fn().mockResolvedValue({ _id: 'u1', inviteCode: 'generated' });
    const res = await service.getQr('u1');
    expect(userModel.findByIdAndUpdate).toHaveBeenCalled();
    expect(res.inviteCode).toBeDefined();
    expect(res.inviteLink).toContain(res.inviteCode);
  });

  it('getQr reuses an existing inviteCode', async () => {
    userModel.findById = jest.fn().mockResolvedValue({ _id: 'u1', inviteCode: 'existing' });
    const res = await service.getQr('u1');
    expect(res.inviteCode).toBe('existing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/users/users.service.spec.ts`
Expected: FAIL — getQr missing.

- [ ] **Step 3: Add to `users.service.ts`**

Add imports:
```ts
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
```
Inject config in the constructor:
```ts
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private config: ConfigService,
  ) {}
```
Add methods:
```ts
  async getQr(userId: string): Promise<{ inviteCode: string; inviteLink: string }> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    let code = user.inviteCode;
    if (!code) {
      code = uuidv4();
      await this.userModel.findByIdAndUpdate(userId, { $set: { inviteCode: code } });
    }
    const base = this.config.get<string>('APP_BASE_URL') ?? '';
    return { inviteCode: code, inviteLink: `${base}/u/${code}` };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/users/users.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "feat(users): profile QR / invite-link (server-generated inviteCode)"
```
End with the Co-Authored-By trailer.

---

## Task 5: Service — public profile + match history + stats (partial/stubbed)

**Files:**
- Modify: `src/users/users.service.ts`
- Modify: `src/users/users.module.ts` (register EventPlayer + Event models)
- Test: `src/users/users.service.spec.ts` (extend)

**Context:** match history joins `EventPlayer` (status 'joined', by userId) → `Event`. Stats: `matchesPlayed` = count of joined events whose status is a completed one (`after_match`/`done` once §4.5 lands; for now count all joined). `wins`/`mvpCount`/`avgRating` = 0 with TODO (need §4.5 result + §4.10 ratings). Privacy filtering applied here.

- [ ] **Step 1: Extend the test**

```ts
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Event } from '../events/schemas/event.schema';

// add EventPlayer + Event mocks to the TestingModule providers in beforeEach:
//   { provide: getModelToken(EventPlayer.name), useValue: playerModel },
//   { provide: getModelToken(Event.name), useValue: eventModel },

it('getPublicProfile hides email/phone and respects private visibility', async () => {
  userModel.findById = jest.fn().mockReturnValue({
    select: () => ({ lean: () => Promise.resolve({
      _id: 'u2', name: 'Bob', email: 'bob@x.com', phoneNumber: '123',
      privacy: { profileVisibility: 'private', showStats: true, showMatchHistory: true },
    }) }),
  });
  await expect(service.getPublicProfile('u2')).rejects.toBeInstanceOf(NotFoundException);
});

it('getPublicProfile returns filtered profile + stats shape for public users', async () => {
  userModel.findById = jest.fn().mockReturnValue({
    select: () => ({ lean: () => Promise.resolve({
      _id: 'u3', name: 'Cara', email: 'c@x.com', phoneNumber: '999', country: 'TH',
      privacy: { profileVisibility: 'public', showStats: true, showMatchHistory: true },
    }) }),
  });
  playerModel.find = jest.fn().mockReturnValue({ lean: () => Promise.resolve([]) });
  const res = await service.getPublicProfile('u3');
  expect(res.email).toBeUndefined();
  expect(res.phoneNumber).toBeUndefined();
  expect(res.name).toBe('Cara');
  expect(res.statistics).toEqual(expect.objectContaining({ matchesPlayed: expect.any(Number), wins: 0, mvpCount: 0 }));
  expect(Array.isArray(res.matchHistory)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/users/users.service.spec.ts`
Expected: FAIL — getPublicProfile missing / constructor lacks the two models.

- [ ] **Step 3: Add to `users.service.ts`**

Add imports + inject the two models:
```ts
import { EventPlayer, EventPlayerDocument } from '../events/schemas/event-player.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
// in constructor:
    @InjectModel(EventPlayer.name) private playerModel: Model<EventPlayerDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
```
Add methods:
```ts
  private readonly PUBLIC_FIELDS = [
    '_id', 'name', 'username', 'displayName', 'profileImage', 'biography',
    'country', 'city', 'sports', 'preferredSport', 'footballPosition',
    'height', 'weight', 'dateOfBirth', 'gallery', 'highlightVideos', 'createdAt',
  ];

  private async getMatchHistory(userId: string) {
    const rows = await this.playerModel
      .find({ userId: new Types.ObjectId(userId), status: 'joined' })
      .lean();
    const eventIds = rows.map((r) => r.eventId);
    if (eventIds.length === 0) return [];
    const events = await this.eventModel
      .find({ _id: { $in: eventIds } })
      .select('title date locationName sportType status result')
      .sort({ date: -1 })
      .lean();
    return events;
  }

  private async buildStatistics(userId: string) {
    // matchesPlayed is real (joined events). wins/mvpCount/avgRating require
    // §4.5 after-match results and §4.10 ratings — return 0 until those exist.
    const matchesPlayed = await this.playerModel.countDocuments({
      userId: new Types.ObjectId(userId),
      status: 'joined',
    });
    return {
      matchesPlayed,
      wins: 0, // TODO(§4.5): compute from Event.result once After-Match lands
      mvpCount: 0, // TODO(§4.5): count Event.result.mvpUserId === userId
      avgRating: 0, // TODO(§4.10): average from ratings collection
    };
  }

  async getPublicProfile(targetUserId: string) {
    const user = await this.userModel
      .findById(targetUserId)
      .select(USER_SENSITIVE_PROJECTION)
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const privacy = (user as any).privacy ?? {
      profileVisibility: 'public', showStats: true, showMatchHistory: true,
    };
    // 'private' hides the profile; 'members' is treated as public for now
    // TODO: scope 'members' to shared-group membership of the viewer.
    if (privacy.profileVisibility === 'private') {
      throw new NotFoundException('Profile is private');
    }

    const base: Record<string, unknown> = {};
    for (const f of this.PUBLIC_FIELDS) {
      if ((user as any)[f] !== undefined) base[f] = (user as any)[f];
    }
    if (privacy.showStats) base.statistics = await this.buildStatistics(targetUserId);
    if (privacy.showMatchHistory) base.matchHistory = await this.getMatchHistory(targetUserId);
    return base;
  }
```

- [ ] **Step 4: Register models in `users.module.ts`**

Import EventPlayer/Event schemas and add them to `MongooseModule.forFeature([...])`:
```ts
import { EventPlayer, EventPlayerSchema } from '../events/schemas/event-player.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
// forFeature array gains:
//   { name: EventPlayer.name, schema: EventPlayerSchema },
//   { name: Event.name, schema: EventSchema },
```
Also ensure `ConfigModule` is available for the injected `ConfigService` (it's global in app.module — verify; if not, import it). Confirm by building.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/users/users.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts src/users/users.module.ts
git commit -m "feat(users): public profile with privacy filtering, match history, stats (partial)"
```
End with the Co-Authored-By trailer.

---

## Task 6: Controller — QR + public profile routes; whitelist test

**Files:**
- Modify: `src/users/users.controller.ts`
- Test: `src/users/users.controller.spec.ts` (create)

**Note on route order:** `GET /users/me/qr` must be declared BEFORE `GET /users/:id/profile` is irrelevant (different depth), but ensure `me` routes are not shadowed by a `:id` route. Current controller has `GET me`, `PATCH me`, `POST me/avatar`. Add `GET me/qr` (still under `me`) and `GET :id/profile`. No shadowing since `:id/profile` has the `/profile` suffix.

- [ ] **Step 1: Add routes**

```ts
  @Get('me/qr')
  getQr(@CurrentUser() user: any) {
    return this.usersService.getQr(user._id.toString());
  }

  @Get(':id/profile')
  getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }
```
(Add `Param` to the `@nestjs/common` import.)

- [ ] **Step 2: Write the controller + whitelist test**

```ts
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController profile routes', () => {
  let controller: UsersController;
  const svc = {
    getQr: jest.fn().mockResolvedValue({ inviteCode: 'x', inviteLink: 'l' }),
    getPublicProfile: jest.fn().mockResolvedValue({ name: 'Bob' }),
    updateProfile: jest.fn().mockResolvedValue({}),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: svc }],
    }).compile();
    controller = m.get(UsersController);
  });
  it('GET me/qr delegates', async () => {
    await controller.getQr({ _id: 'u1' } as any);
    expect(svc.getQr).toHaveBeenCalledWith('u1');
  });
  it('GET :id/profile delegates', async () => {
    await controller.getPublicProfile('u2');
    expect(svc.getPublicProfile).toHaveBeenCalledWith('u2');
  });
});
```

- [ ] **Step 3: Add a DTO whitelist unit test** (proves identity fields can't be set)

Add to `src/users/dto/update-profile.dto.spec.ts` (create):
```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto whitelist', () => {
  it('does not declare identity fields (cognitoSub/email/emailVerified/inviteCode)', () => {
    const dto = new UpdateProfileDto();
    expect('cognitoSub' in dto || Object.prototype.hasOwnProperty.call(UpdateProfileDto.prototype, 'cognitoSub')).toBe(false);
    // the real guarantee is the global ValidationPipe whitelist:true stripping unknowns;
    // this test documents intent — identity fields are simply not part of the DTO.
    const instance = plainToInstance(UpdateProfileDto, { footballPosition: 'goalkeeper' });
    expect(validateSync(instance)).toHaveLength(0);
    const bad = plainToInstance(UpdateProfileDto, { footballPosition: 'striker' });
    expect(validateSync(bad).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run tests + build**

Run: `npx jest src/users`
Expected: all pass.
Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' || echo BUILD_GREEN`
Expected: BUILD_GREEN.

- [ ] **Step 5: Commit**

```bash
git add src/users/users.controller.ts src/users/users.controller.spec.ts src/users/dto/update-profile.dto.spec.ts
git commit -m "feat(users): me/qr + public profile routes, DTO whitelist test"
```
End with the Co-Authored-By trailer.

---

## Task 7: Full gate + manual smoke

**Files:** possibly existing tests referencing the user shape.

- [ ] **Step 1: Full unit suite**

Run: `npx jest`
Expected: all pass. Fix any test asserting the old user shape (unlikely — additive change).

- [ ] **Step 2: Build + scoped lint**

Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' || echo BUILD_GREEN`
Run: `npx eslint --fix src/users` (scope to users; do NOT run repo-wide `npm run lint`).

- [ ] **Step 3: Manual smoke (optional, needs a running server + a confirmed Cognito user)**

```
# edit profile
curl -s -X PATCH localhost:3000/users/me -H "Authorization: Bearer <accessToken>" -H 'Content-Type: application/json' \
  -d '{"biography":"midfielder from BKK","country":"TH","city":"Bangkok","sports":["football"],"preferredSport":"football","footballPosition":"midfielder","privacy":{"profileVisibility":"public"}}'
# QR
curl -s localhost:3000/users/me/qr -H "Authorization: Bearer <accessToken>"
# public profile (email/phone must be absent)
curl -s localhost:3000/users/<yourUserId>/profile -H "Authorization: Bearer <accessToken>"
# whitelist proof — try to set email; response must NOT change email
curl -s -X PATCH localhost:3000/users/me -H "Authorization: Bearer <accessToken>" -H 'Content-Type: application/json' -d '{"email":"attacker@evil.com"}'
```
Expected: profile updates; QR returns code+link; public profile omits email/phoneNumber; the email-injection PATCH is rejected/stripped (400 forbidNonWhitelisted or silently ignored — email unchanged).

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "test(users): reconcile suite with profile fields"
```
End with the Co-Authored-By trailer.

---

## Self-Review Notes (addressed)

- **Spec coverage:** §4.2 fields — biography, country, city, sports, preferred position, dateOfBirth (age derivable), profile picture (existing), QR/invite (Task 4), match history + statistics (Task 5, partial per decision), gallery + highlightVideos (fields present; upload routes deferred). §4.1 — country/city selection, sport preferences, football position selection, privacy settings (Tasks 2–3). Name/username/height/weight already existed.
- **Security:** identity fields excluded from the DTO (Task 3 + the whitelist test in Task 6); public profile strips email/phone/cognitoSub and honors privacy (Task 5). inviteCode is server-generated only.
- **Honest stubs:** wins/mvpCount/avgRating/highlightVideos return 0/empty with explicit TODO tied to §4.5 and §4.10 — NOT faked. matchesPlayed + match history are real from existing data.
- **Type consistency:** enums come from one `profile.constants.ts` used by schema, DTO, and validation. `getQr`, `getPublicProfile`, `buildStatistics`, `getMatchHistory` signatures match across service, controller, and tests.
- **Module wiring:** users.module registers EventPlayer + Event for the history/stats join; ConfigService for the invite link base URL (verify ConfigModule global).

---

## Follow-ups unblocked / needed

1. **Wire real stats** once Event lifecycle §4.5 (After-Match results) and Ratings §4.10 exist — replace the three `0` stubs in `buildStatistics`.
2. **Highlight video + gallery upload** — needs a media-upload plan (current multer is image-only, 5MB).
3. **`members`-scoped visibility** — resolve the viewer's shared-group membership before returning the profile.
