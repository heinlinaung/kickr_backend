# Location + Group Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the creator-owned `Location` collection (spec §3) and extend Groups (spec §4) with logo, sportType, handle, teamRules, `locations[]`, the captain role + member levels, group search, and the QR invite payload — replacing the flat `locationName/latitude/longitude` fields on Group and Event.

**Architecture:** A new `locations` module owns the `Location` schema (creator-owned via `createdBy`; `lat`/`lng` plus a derived GeoJSON `geo` with a `2dsphere` index; **no dedupe** — every create inserts). Groups reference locations by id (`locations: [ObjectId]`, max 5) and Events by `locationId`; a location never points back at its consumers. Group uploads (logo, wallpaper) move to the existing `ImageKitService`. Member seniority becomes a `level: 1|2|3` field alongside an extended `role` enum that adds `captain`.

**Tech Stack:** NestJS 11 · MongoDB (Mongoose) · ImageKit (`ImageKitService`, already built) · `uuid` (invite codes, already used).

**Spec reference:** `docs/superpowers/specs/2026-07-28-kickr-spec-v2-changes.md` §3 (Location), §4 (Groups), workflow diagrams §13.2 and §13.7.

---

## Design decisions (locked with product)

1. **Locations are creator-owned, NOT a global registry.** `createdBy` is the owner; only the owner may `PATCH`/`DELETE`. Two users adding the same pitch produce two rows — **intentional**.
2. **No dedupe.** `POST /locations` always inserts. No name/proximity matching.
3. **Reusable by the creator.** The owner may attach one location to any number of *their own* groups/events.
4. **Keep `geo` + `2dsphere`.** `lat`/`lng` are the authored fields; `geo` is derived in a pre-save hook so they can't drift. Enables the later "events near me" query.
5. **Attach permission:** caller must be the group's owner/admin **and** the location's `createdBy`.
6. **Detach ≠ delete.** Removing a location from a group only removes the ref.
7. **Member levels:** `level: 1|2|3` (default 1) alongside `role` gaining `captain`. The "plus one" flow is **deferred** — spec decision §14 #10 is still open, so this plan builds `role`+`level` only.
8. **Invite-link approval** (§14 #5) is **unchanged** in this plan — `join-by-code` keeps its current auto-approve behaviour. Do not change it here.

---

## Current state (verified against source)

**`Group`** (`src/groups/schemas/group.schema.ts`): `name`, `description`, `ownerId`, `wallpaper`, `locationName`, `latitude`, `longitude`, `isPrivate`, `maxPlayers`, `inviteCode`, `inviteCodeExpiry`. Unique sparse index on `inviteCode`.

**`GroupMember`**: `groupId`, `userId`, `role` (enum `owner|admin|member`), `status` (enum `pending|approved`), `joinedAt`. Unique compound index `{groupId, userId}`.

**`GroupsService`** has: `getMyGroups`, `create`, `findById`, `update`, `updateWallpaper`, `listMembers`, `removeMember`, `generateInviteCode`, `getMemberRole`, `assertOwnerOrAdmin`.

> **Note:** `updateWallpaper` still writes a local-disk path (`/uploads/groups/${filename}`). Task 6 migrates it to ImageKit alongside adding `logo`.

**`CreateGroupDto`**: name, description, locationName, latitude, longitude, isPrivate, maxPlayers.
**`UpdateGroupDto`**: name, description, maxPlayers.

**Events** also carry the flat trio (`src/events/schemas/event.schema.ts` + `create-event.dto.ts`) and `src/users/users.service.ts:165` selects `locationName` in the match-history projection.

---

## File Structure

**Create:**
- `src/locations/schemas/location.schema.ts` — `Location` + `2dsphere`/`createdBy` indexes + pre-save `geo` hook.
- `src/locations/dto/create-location.dto.ts`, `src/locations/dto/update-location.dto.ts`
- `src/locations/locations.service.ts` — create/list-mine/find/update/delete + `assertOwner`.
- `src/locations/locations.controller.ts`
- `src/locations/locations.module.ts` — exports `LocationsService` + `MongooseModule`.
- `src/locations/locations.service.spec.ts`, `src/locations/locations.controller.spec.ts`, `src/locations/schemas/location.schema.spec.ts`
- `src/groups/dto/attach-location.dto.ts`, `src/groups/dto/update-member-role.dto.ts`, `src/groups/dto/group-rules.dto.ts`
- `src/groups/groups.service.spec.ts` (does not exist yet)

**Modify:**
- `src/groups/schemas/group.schema.ts` — add `logo`, `logoFileId`, `wallpaperFileId`, `sportType`, `handle` (unique sparse), `teamRules: [string]`, `locations: [ObjectId]`; **remove** `locationName`, `latitude`, `longitude`.
- `src/groups/schemas/group-member.schema.ts` — `role` enum += `captain`; add `level`.
- `src/groups/dto/create-group.dto.ts` — drop the flat trio; add `sportType`, `handle`, `locationIds?`.
- `src/groups/dto/update-group.dto.ts` — add `sportType`, `handle`, `teamRules`, `isPrivate`.
- `src/groups/groups.service.ts` — logo/wallpaper via ImageKit; `search`; `getQr`; `attachLocation`/`detachLocation`/`listLocations`; `updateMemberRole`; `setRules`.
- `src/groups/groups.controller.ts` — new routes (§4.6 of the spec).
- `src/groups/groups.module.ts` — import `UploadModule` + `LocationsModule`.
- `src/events/schemas/event.schema.ts`, `src/events/dto/create-event.dto.ts` — flat trio → `locationId`.
- `src/users/users.service.ts` — match-history projection: `locationName` → populate `locationId`.
- `src/app.module.ts` — register `LocationsModule`.

**Out of scope (documented):** the "plus one" invite flow (§14 #10 open); changing `join-by-code` approval (§14 #5 open); group `posts` and `gallery` (separate pass); Event geo-discovery query (`GET /events?near=`) — this plan only puts the data in place for it.

---

## Task 1: Location schema (creator-owned, geo-derived)

**Files:**
- Create: `src/locations/schemas/location.schema.ts`
- Test: `src/locations/schemas/location.schema.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { LocationSchema } from './location.schema';

describe('Location schema', () => {
  it('has the authored + derived paths', () => {
    const paths = Object.keys(LocationSchema.paths);
    expect(paths).toEqual(
      expect.arrayContaining(['name', 'lat', 'lng', 'url', 'metadata', 'createdBy']),
    );
  });

  it('requires name, lat, lng and createdBy', () => {
    expect((LocationSchema.path('name') as any).isRequired).toBe(true);
    expect((LocationSchema.path('lat') as any).isRequired).toBe(true);
    expect((LocationSchema.path('lng') as any).isRequired).toBe(true);
    expect((LocationSchema.path('createdBy') as any).isRequired).toBe(true);
  });

  it('derives geo from lat/lng on validate', async () => {
    const doc: any = { name: 'Pitch', lat: 13.7563, lng: 100.5018 };
    // run the registered pre-validate/pre-save hook logic via a bare instance
    const Model = require('mongoose').model('LocationSpec', LocationSchema);
    const inst = new Model({ ...doc, createdBy: new (require('mongoose').Types.ObjectId)() });
    await inst.validate();
    expect(inst.geo.type).toBe('Point');
    expect(inst.geo.coordinates).toEqual([100.5018, 13.7563]); // [lng, lat]
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/locations/schemas/location.schema.spec.ts`
Expected: FAIL — cannot find module `./location.schema`.

- [ ] **Step 3: Implement the schema**

```ts
// src/locations/schemas/location.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export type LocationDocument = HydratedDocument<Location>;

@Schema({ timestamps: true })
export class Location {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  lat: number;

  @Prop({ required: true })
  lng: number;

  // Derived from lat/lng — callers never set this directly.
  @Prop({
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: { type: [Number] },
    _id: false,
  })
  geo: { type: string; coordinates: number[] };

  @Prop()
  url: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;

  // OWNER. Only this user may edit or delete the row.
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  createdBy: Types.ObjectId;
}

export const LocationSchema = SchemaFactory.createForClass(Location);

// Keep geo in sync with the authored lat/lng so the two cannot drift.
LocationSchema.pre('validate', function (next) {
  const doc = this as unknown as Location;
  if (typeof doc.lat === 'number' && typeof doc.lng === 'number') {
    doc.geo = { type: 'Point', coordinates: [doc.lng, doc.lat] };
  }
  next();
});

LocationSchema.index({ geo: '2dsphere' });
LocationSchema.index({ name: 1 });
```

> If the `geo` sub-object typing fights TypeScript, declare the prop with `@Prop({ type: Object })` and keep the runtime shape — do NOT drop the 2dsphere index. Report if you had to deviate.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/locations/schemas/location.schema.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/locations/schemas/
git commit -m "feat(locations): Location schema, creator-owned with derived GeoJSON"
```
End every commit body with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 2: Location DTOs + service (create / list-mine / update / delete)

**Files:**
- Create: `src/locations/dto/create-location.dto.ts`, `src/locations/dto/update-location.dto.ts`
- Create: `src/locations/locations.service.ts`
- Test: `src/locations/locations.service.spec.ts`

- [ ] **Step 1: Create the DTOs**

`create-location.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsObject, MinLength, Min, Max, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLocationDto {
  @ApiProperty({ example: 'Shwe Pitch, Bangkok', minLength: 2 })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 13.7563 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 100.5018 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiProperty({ required: false, example: 'https://maps.google.com/?q=13.7563,100.5018' })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiProperty({ required: false, example: { surface: 'grass', indoor: false, pitches: 2 } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
```

`update-location.dto.ts`: same fields, all `@IsOptional()`, and **no** `createdBy` (owner is never client-settable).

- [ ] **Step 2: Write the failing service test**

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { Location } from './schemas/location.schema';

describe('LocationsService', () => {
  let service: LocationsService;
  const model: any = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        LocationsService,
        { provide: getModelToken(Location.name), useValue: model },
      ],
    }).compile();
    service = m.get(LocationsService);
  });

  it('create always inserts and stamps createdBy (no dedupe)', async () => {
    model.create = jest.fn().mockResolvedValue({ _id: 'l1', name: 'Pitch' });
    const dto = { name: 'Pitch', lat: 1, lng: 2 } as any;
    await service.create('u1', dto);
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pitch', lat: 1, lng: 2 }),
    );
    // createdBy must be set from the caller, not the payload
    const arg = model.create.mock.calls[0][0];
    expect(arg.createdBy.toString()).toBe(expect.any(String) as any || arg.createdBy.toString());
    // no lookup happened → no dedupe
    expect(model.findOne).toBeUndefined();
  });

  it('listMine filters by createdBy', async () => {
    model.find = jest.fn().mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
    await service.listMine('u1');
    expect(model.find).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: expect.anything() }),
    );
  });

  it('update rejects a non-owner', async () => {
    model.findById = jest.fn().mockResolvedValue({
      _id: 'l1', createdBy: { toString: () => 'someoneElse' },
    });
    await expect(service.update('l1', 'u1', { name: 'x' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update applies for the owner', async () => {
    model.findById = jest.fn().mockResolvedValue({
      _id: 'l1', createdBy: { toString: () => 'u1' },
    });
    model.findByIdAndUpdate = jest.fn().mockReturnValue({
      lean: () => Promise.resolve({ _id: 'l1', name: 'new' }),
    });
    const res = await service.update('l1', 'u1', { name: 'new' } as any);
    expect(res.name).toBe('new');
  });

  it('remove rejects a non-owner and 404s when missing', async () => {
    model.findById = jest.fn().mockResolvedValue(null);
    await expect(service.remove('nope', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/locations/locations.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the service**

```ts
// src/locations/locations.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Location, LocationDocument } from './schemas/location.schema';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name) private locationModel: Model<LocationDocument>,
  ) {}

  /** Always inserts — locations are creator-owned, duplicates across users are intended. */
  async create(userId: string, dto: CreateLocationDto) {
    return this.locationModel.create({
      ...dto,
      createdBy: new Types.ObjectId(userId),
    });
  }

  async listMine(userId: string) {
    return this.locationModel
      .find({ createdBy: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();
  }

  async findById(locationId: string) {
    const loc = await this.locationModel.findById(locationId).lean();
    if (!loc) throw new NotFoundException('Location not found');
    return loc;
  }

  /** Loads the row and asserts the caller owns it. Returns the doc. */
  private async assertOwner(locationId: string, userId: string) {
    const loc = await this.locationModel.findById(locationId);
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.createdBy.toString() !== userId) {
      throw new ForbiddenException('Only the location owner can modify it');
    }
    return loc;
  }

  async update(locationId: string, userId: string, dto: UpdateLocationDto) {
    await this.assertOwner(locationId, userId);
    const updated = await this.locationModel
      .findByIdAndUpdate(locationId, { $set: dto }, { new: true })
      .lean();
    if (!updated) throw new NotFoundException('Location not found');
    return updated;
  }

  async remove(locationId: string, userId: string) {
    await this.assertOwner(locationId, userId);
    await this.locationModel.deleteOne({ _id: new Types.ObjectId(locationId) });
    return { message: 'Location deleted' };
  }

  /** Used by group attach to enforce "you attach your own locations". */
  async assertOwnedBy(locationId: string, userId: string) {
    await this.assertOwner(locationId, userId);
  }
}
```

> **Important on `update`:** a `findByIdAndUpdate` with `$set: {lat, lng}` does NOT fire the `pre('validate')` hook, so `geo` would go stale. Fix by loading the doc in `assertOwner`, assigning the fields, and calling `.save()` instead — OR add `runValidators: true` plus a `pre('findOneAndUpdate')` hook that recomputes `geo`. **Implement the `.save()` route** (simplest, guaranteed correct) and add a test asserting `geo` updates when `lat`/`lng` change.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/locations/locations.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/locations/
git commit -m "feat(locations): DTOs + service (create/list-mine/update/delete, owner-gated)"
```

---

## Task 3: Location controller + module + app wiring

**Files:**
- Create: `src/locations/locations.controller.ts`, `src/locations/locations.module.ts`
- Test: `src/locations/locations.controller.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Implement the controller**

```ts
// src/locations/locations.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@ApiTags('Locations')
@ApiBearerAuth()
@Controller('locations')
@UseGuards(JwtAuthGuard)
export class LocationsController {
  constructor(private locationsService: LocationsService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateLocationDto) {
    return this.locationsService.create(user._id.toString(), dto);
  }

  @Get()
  listMine(@CurrentUser() user: any) {
    return this.locationsService.listMine(user._id.toString());
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateLocationDto) {
    return this.locationsService.update(id, user._id.toString(), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.locationsService.remove(id, user._id.toString());
  }
}
```

- [ ] **Step 2: Implement the module**

```ts
// src/locations/locations.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { Location, LocationSchema } from './schemas/location.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Location.name, schema: LocationSchema }])],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService, MongooseModule],
})
export class LocationsModule {}
```

- [ ] **Step 3: Register in `src/app.module.ts`**

Read the file, import `LocationsModule`, and add it to the `imports` array alongside the other feature modules.

- [ ] **Step 4: Write the controller spec**

Mock `LocationsService`; assert each of the five routes delegates with `(id?, userId, dto?)` as appropriate. Follow the style of `src/users/users.controller.spec.ts`.

- [ ] **Step 5: Run tests + build**

Run: `npx jest src/locations`
Expected: PASS.
Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' || echo BUILD_GREEN`
Expected: BUILD_GREEN.

- [ ] **Step 6: Commit**

```bash
git add src/locations/ src/app.module.ts
git commit -m "feat(locations): controller + module, registered in app"
```

---

## Task 4: Group schema — new fields, drop the flat trio

**Files:**
- Modify: `src/groups/schemas/group.schema.ts`
- Modify: `src/groups/schemas/group-member.schema.ts`
- Test: `src/groups/schemas/group.schema.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { GroupSchema } from './group.schema';
import { GroupMemberSchema } from './group-member.schema';

describe('Group schema (v2 extensions)', () => {
  it('adds logo/sportType/handle/teamRules/locations', () => {
    const paths = Object.keys(GroupSchema.paths);
    expect(paths).toEqual(expect.arrayContaining([
      'logo', 'logoFileId', 'wallpaperFileId', 'sportType', 'handle', 'teamRules', 'locations',
    ]));
  });

  it('removes the flat location fields', () => {
    const paths = Object.keys(GroupSchema.paths);
    expect(paths).not.toContain('locationName');
    expect(paths).not.toContain('latitude');
    expect(paths).not.toContain('longitude');
  });
});

describe('GroupMember schema (roles + levels)', () => {
  it('role enum includes captain', () => {
    expect((GroupMemberSchema.path('role') as any).options.enum)
      .toEqual(['owner', 'admin', 'captain', 'member']);
  });

  it('has a level defaulting to 1', () => {
    const level: any = GroupMemberSchema.path('level');
    expect(level).toBeDefined();
    expect(level.options.default).toBe(1);
    expect(level.options.enum).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/groups/schemas/group.schema.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Edit `group.schema.ts`**

Add:
```ts
  @Prop()
  logo: string;

  @Prop()
  logoFileId: string;

  @Prop()
  wallpaperFileId: string;

  @Prop({ enum: ['football', 'futsal', 'padel', 'basketball'] })
  sportType: string;

  @Prop({ trim: true })
  handle: string;

  @Prop({ type: [String], default: [] })
  teamRules: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Location' }], default: [] })
  locations: Types.ObjectId[];
```
**Remove** the `locationName`, `latitude`, `longitude` props.

Add below the schema factory:
```ts
GroupSchema.index({ handle: 1 }, { unique: true, sparse: true });
GroupSchema.index({ name: 'text' });
```

- [ ] **Step 4: Edit `group-member.schema.ts`**

Change the role prop and add level:
```ts
  @Prop({ default: 'member', enum: ['owner', 'admin', 'captain', 'member'] })
  role: string;

  @Prop({ default: 1, enum: [1, 2, 3] })
  level: number;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/groups/schemas/group.schema.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Confirm what now breaks** (expected — fixed in Tasks 5–8)

Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' | sed 's/^/  /'`
Expected: errors only in `src/groups/**` (DTO/service referencing removed fields). **Report the exact list.** If anything outside `src/groups` breaks, report DONE_WITH_CONCERNS.

- [ ] **Step 7: Commit**

```bash
git add src/groups/schemas/
git commit -m "feat(groups): add logo/sportType/handle/teamRules/locations, captain role + levels"
```

---

## Task 5: Group DTOs

**Files:**
- Modify: `src/groups/dto/create-group.dto.ts`, `src/groups/dto/update-group.dto.ts`
- Create: `src/groups/dto/attach-location.dto.ts`, `src/groups/dto/update-member-role.dto.ts`, `src/groups/dto/group-rules.dto.ts`

- [ ] **Step 1: Update `create-group.dto.ts`**

**Remove** `locationName`, `latitude`, `longitude`. Keep name/description/isPrivate/maxPlayers. Add:
```ts
  @ApiProperty({ required: false, enum: ['football', 'futsal', 'padel', 'basketball'] })
  @IsOptional()
  @IsIn(['football', 'futsal', 'padel', 'basketball'])
  sportType?: string;

  @ApiProperty({ required: false, example: 'bangkok-fc' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_.-]+$/, { message: 'handle must be lowercase alphanumeric, dot, dash or underscore' })
  handle?: string;

  @ApiProperty({ required: false, type: [String], description: 'existing Location ids owned by the caller (max 5)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsMongoId({ each: true })
  locationIds?: string[];
```
(Add the needed imports from `class-validator`.)

- [ ] **Step 2: Update `update-group.dto.ts`**

Keep name/description/maxPlayers; add optional `sportType`, `handle` (same validators as above), `isPrivate` (`@IsBoolean()`), and `teamRules`:
```ts
  @ApiProperty({ required: false, type: [String], description: 'max 3 rules' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  teamRules?: string[];
```

- [ ] **Step 3: Create `attach-location.dto.ts`**

Accept **either** an existing id or a new location payload:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateLocationDto } from '../../locations/dto/create-location.dto';

export class AttachLocationDto {
  @ApiProperty({ required: false, description: 'existing location id (must be owned by the caller)' })
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @ApiProperty({ required: false, type: CreateLocationDto, description: 'create + attach in one call' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateLocationDto)
  location?: CreateLocationDto;
}
```

- [ ] **Step 4: Create `update-member-role.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMemberRoleDto {
  @ApiProperty({ required: false, enum: ['admin', 'captain', 'member'] })
  @IsOptional()
  @IsIn(['admin', 'captain', 'member'])
  role?: string;

  @ApiProperty({ required: false, enum: [1, 2, 3] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3])
  level?: number;
}
```
> `owner` is deliberately NOT assignable via this DTO — ownership transfer is out of scope.

- [ ] **Step 5: Create `group-rules.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMaxSize, IsString } from 'class-validator';

export class SetGroupRulesDto {
  @ApiProperty({ type: [String], description: 'max 3 rules' })
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  rules: string[];
}
```

- [ ] **Step 6: Verify DTOs compile**

Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' | grep 'dto' || echo "dtos compile"`
Expected: `dtos compile` (service errors remain — Task 6).

- [ ] **Step 7: Commit**

```bash
git add src/groups/dto/
git commit -m "feat(groups): DTOs for sportType/handle/rules/locations/member-role"
```

---

## Task 6: GroupsService — ImageKit uploads, search, QR, rules

**Files:**
- Modify: `src/groups/groups.service.ts`, `src/groups/groups.module.ts`
- Test: `src/groups/groups.service.spec.ts` (create)

**Context:** `updateWallpaper` currently writes `/uploads/groups/${filename}`. Migrate it to ImageKit (mirroring `UsersService.updateAvatar`) and add `updateLogo` the same way. `ImageKitService` is exported by `UploadModule`.

- [ ] **Step 1: Write the failing test**

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GroupsService } from './groups.service';
import { Group } from './schemas/group.schema';
import { GroupMember } from './schemas/group-member.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import { LocationsService } from '../locations/locations.service';

describe('GroupsService (v2)', () => {
  let service: GroupsService;
  const groupModel: any = {};
  const memberModel: any = {};
  const imagekit = { upload: jest.fn(), deleteFile: jest.fn() };
  const locations = { create: jest.fn(), assertOwnedBy: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: ImageKitService, useValue: imagekit },
        { provide: LocationsService, useValue: locations },
      ],
    }).compile();
    service = m.get(GroupsService);
  });

  it('updateLogo uploads to ImageKit and stores url + fileId', async () => {
    memberModel.findOne = jest.fn().mockResolvedValue({ role: 'owner' });
    groupModel.findById = jest.fn().mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ _id: 'g1', logoFileId: 'oldFid' }) }),
    });
    imagekit.upload.mockResolvedValue({ url: 'https://ik/logo.jpg', fileId: 'newFid' });
    groupModel.findByIdAndUpdate = jest.fn().mockReturnValue({
      lean: () => Promise.resolve({ _id: 'g1', logo: 'https://ik/logo.jpg', logoFileId: 'newFid' }),
    });

    const file = { buffer: Buffer.from('x') } as any;
    const res: any = await service.updateLogo('g1', 'u1', file);
    expect(imagekit.upload).toHaveBeenCalledWith(file.buffer, expect.any(String), 'groups');
    expect(imagekit.deleteFile).toHaveBeenCalledWith('oldFid');
    expect(res.logo).toBe('https://ik/logo.jpg');
  });

  it('search excludes private groups', async () => {
    groupModel.find = jest.fn().mockReturnValue({
      limit: () => ({ lean: () => Promise.resolve([]) }),
    });
    await service.search('bangkok');
    const filter = groupModel.find.mock.calls[0][0];
    expect(filter.isPrivate).toBe(false);
  });

  it('setRules rejects more than 3 rules', async () => {
    memberModel.findOne = jest.fn().mockResolvedValue({ role: 'owner' });
    await expect(service.setRules('g1', 'u1', ['a', 'b', 'c', 'd']))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/groups/groups.service.spec.ts`
Expected: FAIL — methods missing / constructor mismatch.

- [ ] **Step 3: Implement**

Inject the two new deps:
```ts
    private readonly imagekit: ImageKitService,
    private readonly locationsService: LocationsService,
```
Add a logger (`private readonly logger = new Logger(GroupsService.name);`).

**Replace `updateWallpaper`** and **add `updateLogo`** — both follow the avatar pattern (read prior fileId → upload → best-effort delete prior, logging failures → `$set` url + fileId). Use ImageKit folder `'groups'`.

Add:
```ts
  async search(q: string) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return this.groupModel
      .find({ isPrivate: false, $or: [{ name: rx }, { handle: rx }] })
      .limit(20)
      .lean();
  }

  async getQr(groupId: string, userId: string) {
    const code = await this.generateInviteCode(groupId, userId); // already owner/admin-gated
    const base = process.env.APP_BASE_URL ?? '';
    return { inviteCode: code, inviteLink: `${base}/g/${code}` };
  }

  async setRules(groupId: string, userId: string, rules: string[]) {
    await this.assertOwnerOrAdmin(groupId, userId);
    if (rules.length > 3) throw new BadRequestException('At most 3 team rules');
    const group = await this.groupModel
      .findByIdAndUpdate(groupId, { $set: { teamRules: rules } }, { new: true })
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async getRules(groupId: string) {
    const group = await this.groupModel.findById(groupId).select('teamRules').lean();
    if (!group) throw new NotFoundException('Group not found');
    return { rules: (group as any).teamRules ?? [] };
  }
```
> Prefer injecting `ConfigService` for `APP_BASE_URL` if the codebase does so elsewhere (it does in `UsersService.getQr`) — match that pattern instead of `process.env`.

Update `groups.module.ts` to import `UploadModule` and `LocationsModule`.

- [ ] **Step 4: Run test + build**

Run: `npx jest src/groups/groups.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/groups.service.ts src/groups/groups.service.spec.ts src/groups/groups.module.ts
git commit -m "feat(groups): ImageKit logo/wallpaper, search, QR payload, team rules"
```

---

## Task 7: GroupsService — locations attach/detach/list, member role & level

**Files:**
- Modify: `src/groups/groups.service.ts`
- Modify: `src/groups/groups.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('attachLocation requires owner/admin AND location ownership, max 5', async () => {
  memberModel.findOne = jest.fn().mockResolvedValue({ role: 'admin' });
  groupModel.findById = jest.fn().mockReturnValue({
    select: () => ({ lean: () => Promise.resolve({ _id: 'g1', locations: ['a','b','c','d','e'] }) }),
  });
  await expect(service.attachLocation('g1', 'u1', { locationId: '507f1f77bcf86cd799439011' } as any))
    .rejects.toThrow(/at most 5/i);
});

it('attachLocation with an existing id verifies caller owns it', async () => {
  memberModel.findOne = jest.fn().mockResolvedValue({ role: 'owner' });
  groupModel.findById = jest.fn().mockReturnValue({
    select: () => ({ lean: () => Promise.resolve({ _id: 'g1', locations: [] }) }),
  });
  groupModel.findByIdAndUpdate = jest.fn().mockReturnValue({
    lean: () => Promise.resolve({ _id: 'g1', locations: ['l1'] }),
  });
  await service.attachLocation('g1', 'u1', { locationId: 'l1' } as any);
  expect(locations.assertOwnedBy).toHaveBeenCalledWith('l1', 'u1');
});

it('attachLocation with a new payload creates the location first', async () => {
  memberModel.findOne = jest.fn().mockResolvedValue({ role: 'owner' });
  groupModel.findById = jest.fn().mockReturnValue({
    select: () => ({ lean: () => Promise.resolve({ _id: 'g1', locations: [] }) }),
  });
  locations.create.mockResolvedValue({ _id: 'newL' });
  groupModel.findByIdAndUpdate = jest.fn().mockReturnValue({
    lean: () => Promise.resolve({ _id: 'g1', locations: ['newL'] }),
  });
  await service.attachLocation('g1', 'u1', { location: { name: 'P', lat: 1, lng: 2 } } as any);
  expect(locations.create).toHaveBeenCalledWith('u1', expect.objectContaining({ name: 'P' }));
});

it('updateMemberRole cannot target the owner', async () => {
  memberModel.findOne = jest.fn()
    .mockResolvedValueOnce({ role: 'admin' })          // requester check
    .mockResolvedValueOnce({ role: 'owner' });          // target
  await expect(service.updateMemberRole('g1', 'u1', 'ownerUser', { role: 'member' } as any))
    .rejects.toThrow(/owner/i);
});
```

- [ ] **Step 2: Run → FAIL, then implement**

```ts
  async listLocations(groupId: string) {
    const group = await this.groupModel
      .findById(groupId)
      .populate('locations')
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return (group as any).locations ?? [];
  }

  async attachLocation(groupId: string, userId: string, dto: AttachLocationDto) {
    await this.assertOwnerOrAdmin(groupId, userId);
    const group = await this.groupModel.findById(groupId).select('locations').lean();
    if (!group) throw new NotFoundException('Group not found');
    const current = ((group as any).locations ?? []) as Types.ObjectId[];
    if (current.length >= 5) {
      throw new BadRequestException('A group may have at most 5 locations');
    }

    let locationId: string;
    if (dto.locationId) {
      // must be one of the caller's own locations
      await this.locationsService.assertOwnedBy(dto.locationId, userId);
      locationId = dto.locationId;
    } else if (dto.location) {
      const created = await this.locationsService.create(userId, dto.location);
      locationId = (created as any)._id.toString();
    } else {
      throw new BadRequestException('Provide either locationId or location');
    }

    const updated = await this.groupModel
      .findByIdAndUpdate(
        groupId,
        { $addToSet: { locations: new Types.ObjectId(locationId) } },
        { new: true },
      )
      .lean();
    return updated;
  }

  /** Detach only — never deletes the Location row (§3.3). */
  async detachLocation(groupId: string, userId: string, locationId: string) {
    await this.assertOwnerOrAdmin(groupId, userId);
    const updated = await this.groupModel
      .findByIdAndUpdate(
        groupId,
        { $pull: { locations: new Types.ObjectId(locationId) } },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Group not found');
    return updated;
  }

  async updateMemberRole(
    groupId: string, requesterId: string, targetUserId: string, dto: UpdateMemberRoleDto,
  ) {
    await this.assertOwnerOrAdmin(groupId, requesterId);
    const target = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(targetUserId),
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') {
      throw new ForbiddenException('Cannot change the group owner');
    }
    const patch: Record<string, unknown> = {};
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.level !== undefined) patch.level = dto.level;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Provide role and/or level');
    }
    const updated = await this.memberModel
      .findOneAndUpdate(
        { groupId: new Types.ObjectId(groupId), userId: new Types.ObjectId(targetUserId) },
        { $set: patch },
        { new: true },
      )
      .lean();
    return updated;
  }
```

- [ ] **Step 3: Run tests + build**

Run: `npx jest src/groups`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/groups/
git commit -m "feat(groups): attach/detach locations (max 5, owner-gated), member role + level"
```

---

## Task 8: GroupsController routes

**Files:**
- Modify: `src/groups/groups.controller.ts`
- Modify/create: `src/groups/groups.controller.spec.ts`

**Context:** existing routes are `GET /groups`, `POST /groups`, `GET /groups/:id`, `PATCH /groups/:id`, `POST /groups/:id/wallpaper`, `GET /groups/:id/members`, `DELETE /groups/:id/members/:userId`, `GET /groups/:id/invite-code`.

**Route ordering:** declare `GET /groups/search` **BEFORE** `GET /groups/:id`, or `search` will be captured as an `:id`. This is the one real footgun in this task.

- [ ] **Step 1: Add routes**

```ts
  @Get('search')                                   // MUST precede @Get(':id')
  search(@Query('q') q: string) {
    return this.groupsService.search(q ?? '');
  }

  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  uploadLogo(@Param('id') id: string, @CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return this.groupsService.updateLogo(id, user._id.toString(), file);
  }

  @Get(':id/qr')
  getQr(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.getQr(id, user._id.toString());
  }

  @Get(':id/rules')
  getRules(@Param('id') id: string) {
    return this.groupsService.getRules(id);
  }

  @Post(':id/rules')
  setRules(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: SetGroupRulesDto) {
    return this.groupsService.setRules(id, user._id.toString(), dto.rules);
  }

  @Get(':id/locations')
  listLocations(@Param('id') id: string) {
    return this.groupsService.listLocations(id);
  }

  @Post(':id/locations')
  attachLocation(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: AttachLocationDto) {
    return this.groupsService.attachLocation(id, user._id.toString(), dto);
  }

  @Delete(':id/locations/:locationId')
  detachLocation(@Param('id') id: string, @Param('locationId') locationId: string, @CurrentUser() user: any) {
    return this.groupsService.detachLocation(id, user._id.toString(), locationId);
  }

  @Patch(':id/members/:userId/role')
  updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.groupsService.updateMemberRole(id, user._id.toString(), userId, dto);
  }
```
Also **migrate the existing wallpaper route** to `multerMemoryImageOptions` (from `../common/upload/multer-memory.config`) and pass the whole `file` (matching the avatar route), since Task 6 changed `updateWallpaper` to take a file.

- [ ] **Step 2: Write/extend the controller spec**

Mock `GroupsService`; assert delegation for `search`, `uploadLogo`, `getQr`, `setRules`, `attachLocation`, `detachLocation`, `updateMemberRole`. Include a test documenting that `search` resolves before `:id`.

- [ ] **Step 3: Run tests + build**

Run: `npx jest src/groups src/locations`
Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' || echo BUILD_GREEN`
Expected: PASS + BUILD_GREEN.

- [ ] **Step 4: Commit**

```bash
git add src/groups/
git commit -m "feat(groups): search/logo/qr/rules/locations/member-role routes"
```

---

## Task 9: Event + users migration off the flat location fields, then full gate

**Files:**
- Modify: `src/events/schemas/event.schema.ts`, `src/events/dto/create-event.dto.ts`
- Modify: `src/users/users.service.ts`
- Modify: any events service/spec referencing the removed fields

- [ ] **Step 1: Event schema**

Remove `locationName`, `latitude`, `longitude`; add:
```ts
  @Prop({ type: Types.ObjectId, ref: 'Location', default: null })
  locationId: Types.ObjectId | null;
```

- [ ] **Step 2: Event DTO**

In `create-event.dto.ts`, remove the flat trio and add:
```ts
  @ApiProperty({ required: false })
  @IsOptional()
  @IsMongoId()
  locationId?: string;
```

- [ ] **Step 3: Fix the users match-history projection**

`src/users/users.service.ts` (~line 165) selects `'title date locationName sportType status'`. Change to select `locationId` and populate it:
```ts
      .select('title date locationId sportType status')
      .populate('locationId', 'name lat lng')
```
Update `src/users/users.service.spec.ts` if it asserts the projection string.

- [ ] **Step 4: Sweep for stragglers**

Run: `git grep -n "locationName\|latitude\|longitude" -- src | sed 's/^/  /'`
Expected: **empty**. Fix any remaining hit (events service, specs, e2e).

- [ ] **Step 5: Full gate**

Run: `npx jest`
Expected: all pass. Fix any test still constructing a group/event with the flat fields.
Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' || echo BUILD_GREEN`
Expected: BUILD_GREEN.
Run: `npx eslint --fix src/locations src/groups src/events src/users`
(Scope to touched dirs only — do NOT run repo-wide `npm run lint`, which reformats unrelated files.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(events,users): replace flat location fields with Location ref"
```

---

## Data migration note (deploy-time, not code)

Existing `groups` and `events` rows carry `locationName/latitude/longitude`. A one-off script should, for each row with a non-empty `locationName`:
1. Insert a `Location` with `createdBy` = the group's `ownerId` (or event's `createdBy`), `name` = `locationName`, `lat`/`lng` from the old fields (skip `geo` — the pre-save hook sets it).
2. Set `group.locations = [newId]` / `event.locationId = newId`.
3. `$unset` the three old fields.

**No dedupe** — one Location per source row, per the design. This script is **not** part of this plan's tasks; write it separately when deploying.

---

## Self-Review Notes (addressed)

- **Spec coverage:** §3 Location (Tasks 1–3, creator-owned, no dedupe, geo kept) · §4.2 Group core fields (Tasks 4–6) · §4.3 captain + levels (Tasks 4, 7) · §4.5/§4.6 search + QR (Tasks 6, 8) · §3.2/§3.4 refs + migration (Tasks 4, 7, 9).
- **Deliberately deferred, with reasons:** "plus one" flow (spec decision §14 #10 open); `join-by-code` approval semantics (§14 #5 open); group posts/gallery; the `GET /events?near=` query (data is in place; query is Event-domain work).
- **Type/name consistency:** `assertOwnedBy(locationId, userId)` on `LocationsService` is the single hook Groups uses to enforce location ownership; `updateLogo`/`updateWallpaper` share the avatar upload shape (`(id, userId, file)`); `attachLocation` accepts either `locationId` or `location`.
- **Known footguns called out inline:** (a) `GET /groups/search` must precede `GET /groups/:id`; (b) `findByIdAndUpdate` skips the `geo` pre-validate hook, so location updates must use `.save()`; (c) Task 4 intentionally leaves the build red until Tasks 5–8.
- **ImageKit consistency:** the plan also migrates the pre-existing `updateWallpaper` off its stale local-disk path, so both group images behave like the avatar.
