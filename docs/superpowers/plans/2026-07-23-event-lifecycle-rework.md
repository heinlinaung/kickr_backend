# Event Lifecycle Rework (§4.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Event's 3-state capacity `status` (`open|full|done`) with the spec's 6-state match lifecycle (`join → before_match → preparation → playing → after_match → done`), make capacity a derived concern, gate join/unjoin on lifecycle state, wire shuffle to the Preparation phase (creating team-chat rooms), and add After-Match results (score + MVP + photos) and event templates/cover image.

**Architecture:** Manual, organizer-gated transitions via `PATCH /events/:id/status` with a legal-transition table (no scheduler). Capacity (`joinedCount >= maxPlayers`) becomes a derived boolean, not a status. Shuffle keeps its random Fisher-Yates grouping but is gated to `preparation` and scaffolds per-team chat rooms (a lightweight `EventTeamChat` collection with an `archived` flag, archived on `done`). After-Match adds a `result` sub-document (scoreA/scoreB/mvpUserId) and `photos[]`. Player ratings (§4.10) are a SEPARATE plan; this plan only ensures the `after_match` state exists for ratings to hang off.

**Tech Stack:** NestJS 11 · MongoDB (Mongoose) · Multer (existing local-disk upload for cover/photos) · existing Notifications + Chat modules.

---

## Design decisions (locked with product)

1. **Transitions:** manual, organizer-gated via `PATCH /events/:id/status`. Validate against a legal-transition map. No auto/time-based transitions in this plan.
2. **Shuffle:** keep random Fisher-Yates groups of 6; only allow when `status === 'preparation'`; create per-team chat rooms on shuffle.
3. **Team chats:** scaffold room references (`EventTeamChat` docs keyed by `eventId`+`team`) on Preparation shuffle; set `archived: true` on `done`. Do NOT build full real-time event chat here (that's a follow-up).
4. **After Match:** include final score, MVP selection (one joined player), and after-match photo uploads in this plan. Ratings are §4.10 (separate).

---

## Lifecycle model

Status enum (replaces `open|full|done`):

```
join | before_match | preparation | playing | after_match | done
```

Legal transitions (organizer-gated). "Unjoin" is an action allowed only in `join`, not a state.

| From | To (allowed) |
|---|---|
| `join` | `before_match` |
| `before_match` | `preparation`, `join` (reopen registration) |
| `preparation` | `playing`, `before_match` (revert) |
| `playing` | `after_match` |
| `after_match` | `done` |
| `done` | — (terminal) |

Rules:
- **Join** allowed only when `status === 'join'` AND `joinedCount < maxPlayers`.
- **Unjoin** (leave) allowed only when `status === 'join'`.
- **Shuffle** allowed only when `status === 'preparation'`.
- **Submit result / MVP / photos** allowed only when `status === 'after_match'`.
- On `done`: archive event team chats.

Capacity is derived: `isFull = joinedCount >= maxPlayers`. No `full` status.

---

## File Structure

**Create:**
- `src/events/dto/update-status.dto.ts` — `{ status: <enum> }` validated against the lifecycle enum.
- `src/events/dto/submit-result.dto.ts` — `{ scoreA: number, scoreB: number, mvpUserId?: string }`.
- `src/events/events.lifecycle.ts` — pure module exporting `EVENT_STATUSES`, `LEGAL_TRANSITIONS`, and `canTransition(from, to): boolean`. No Nest deps → trivially unit-testable.
- `src/events/schemas/event-team-chat.schema.ts` — `EventTeamChat { eventId, team, archived, createdAt }`.
- `src/events/events.lifecycle.spec.ts` — unit tests for the transition table.

**Modify:**
- `src/events/schemas/event.schema.ts` — new `status` enum + default `join`; add `startTime`, `endTime`, `coverImage`, `result` (scoreA/scoreB/mvpUserId), `photos: string[]`, `templateId`. Update indexes/comments.
- `src/events/events.service.ts` — re-gate `join()`/`leave()` on `join` state; remove `open/full` capacity-status toggling; add `updateStatus()`, `submitResult()`, `addPhotos()`. Keep atomic capacity guard on join.
- `src/events/events.controller.ts` — add `PATCH /events/:id/status`, `POST /events/:id/result`, `POST /events/:id/photos`, `POST /events/:id/cover`.
- `src/events/events.module.ts` — register `EventTeamChat` model; ensure Multer wiring for cover/photos (reuse `common/upload/multer.config.ts`).
- `src/shuffle/shuffle.service.ts` — gate to `preparation`; create `EventTeamChat` rooms per generated team.
- `src/shuffle/shuffle.module.ts` — register `EventTeamChat` model.
- `src/events/dto/create-event.dto.ts` — accept optional `startTime`, `endTime`, `templateId`, `coverImage` (all optional; no behavior change if omitted).

**Out of scope (documented follow-ups):** event templates CRUD endpoint (`POST /event-templates`) — this plan adds the `templateId` field + prefill-on-create only; the template store is a separate plan. Player ratings (§4.10). Geo discovery / public-event nearby (§4.6). Full real-time event team chat.

---

## Task 1: Lifecycle transition table (pure, TDD)

**Files:**
- Create: `src/events/events.lifecycle.ts`
- Test: `src/events/events.lifecycle.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { EVENT_STATUSES, canTransition } from './events.lifecycle';

describe('event lifecycle', () => {
  it('exposes the 6 spec statuses in order', () => {
    expect(EVENT_STATUSES).toEqual([
      'join', 'before_match', 'preparation', 'playing', 'after_match', 'done',
    ]);
  });

  it('allows legal forward transitions', () => {
    expect(canTransition('join', 'before_match')).toBe(true);
    expect(canTransition('preparation', 'playing')).toBe(true);
    expect(canTransition('after_match', 'done')).toBe(true);
  });

  it('allows the two defined reversals', () => {
    expect(canTransition('before_match', 'join')).toBe(true);
    expect(canTransition('preparation', 'before_match')).toBe(true);
  });

  it('rejects illegal jumps and exits from done', () => {
    expect(canTransition('join', 'playing')).toBe(false);
    expect(canTransition('join', 'done')).toBe(false);
    expect(canTransition('done', 'after_match')).toBe(false);
    expect(canTransition('playing', 'join')).toBe(false);
  });

  it('rejects unknown statuses', () => {
    expect(canTransition('open' as any, 'join')).toBe(false);
    expect(canTransition('join', 'full' as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/events/events.lifecycle.spec.ts`
Expected: FAIL — cannot find module `./events.lifecycle`.

- [ ] **Step 3: Implement**

```ts
export const EVENT_STATUSES = [
  'join',
  'before_match',
  'preparation',
  'playing',
  'after_match',
  'done',
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const LEGAL_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  join: ['before_match'],
  before_match: ['preparation', 'join'],
  preparation: ['playing', 'before_match'],
  playing: ['after_match'],
  after_match: ['done'],
  done: [],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/events/events.lifecycle.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/events/events.lifecycle.ts src/events/events.lifecycle.spec.ts
git commit -m "feat(events): add lifecycle status enum + legal-transition table"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

---

## Task 2: Event schema — new status + after-match/result fields

**Files:**
- Modify: `src/events/schemas/event.schema.ts`
- Test: `src/events/schemas/event.schema.spec.ts` (create)

Current schema (for reference) has `status: { default: 'open', enum: ['open','full','done'] }` and NO result/photos/cover/startTime/endTime/templateId.

- [ ] **Step 1: Write the failing test**

```ts
import { EventSchema } from './event.schema';

describe('Event schema (lifecycle rework)', () => {
  it('status enum is the 6-state lifecycle defaulting to join', () => {
    const path: any = EventSchema.path('status');
    expect(path.options.default).toBe('join');
    expect(path.options.enum).toEqual([
      'join', 'before_match', 'preparation', 'playing', 'after_match', 'done',
    ]);
  });

  it('has result, photos, coverImage, startTime, endTime, templateId paths', () => {
    const paths = Object.keys(EventSchema.paths);
    expect(paths).toEqual(expect.arrayContaining([
      'result.scoreA', 'result.scoreB', 'result.mvpUserId',
      'photos', 'coverImage', 'startTime', 'endTime', 'templateId',
    ]));
  });

  it('no longer allows the legacy open/full status values', () => {
    const path: any = EventSchema.path('status');
    expect(path.options.enum).not.toContain('open');
    expect(path.options.enum).not.toContain('full');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/events/schemas/event.schema.spec.ts`
Expected: FAIL — default is still `open`, result paths missing.

- [ ] **Step 3: Edit the schema**

Replace the `status` prop and add the new fields. Import `EVENT_STATUSES` from the lifecycle module:

```ts
import { EVENT_STATUSES } from '../events.lifecycle';
```

Replace:
```ts
  @Prop({ default: 'open', enum: ['open', 'full', 'done'] })
  status: string;
```
with:
```ts
  @Prop({ default: 'join', enum: [...EVENT_STATUSES] })
  status: string;

  @Prop()
  startTime: Date;

  @Prop()
  endTime: Date;

  @Prop()
  coverImage: string;

  @Prop({
    type: {
      scoreA: { type: Number },
      scoreB: { type: Number },
      mvpUserId: { type: Types.ObjectId, ref: 'User' },
    },
    default: null,
    _id: false,
  })
  result: { scoreA: number; scoreB: number; mvpUserId: Types.ObjectId } | null;

  @Prop({ type: [String], default: [] })
  photos: string[];

  @Prop({ type: Types.ObjectId, ref: 'EventTemplate', default: null })
  templateId: Types.ObjectId | null;
```

(`EventTemplate` ref is a forward reference; the template collection is a follow-up. The ref string is harmless without a registered model since we never populate it here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/events/schemas/event.schema.spec.ts`
Expected: PASS.

- [ ] **Step 5: Verify no non-events type breakage** (events.service will break next — that's expected)

Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' | grep -v -E 'src/events/|src/shuffle/' || echo "no unrelated type errors"`
Expected: `no unrelated type errors` (errors confined to events/shuffle, fixed in later tasks).

- [ ] **Step 6: Commit**

```bash
git add src/events/schemas/event.schema.ts src/events/schemas/event.schema.spec.ts
git commit -m "feat(events): 6-state lifecycle status + result/photos/cover/times fields"
```
End with the Co-Authored-By trailer.

---

## Task 3: EventTeamChat schema (Preparation team rooms)

**Files:**
- Create: `src/events/schemas/event-team-chat.schema.ts`
- Test: `src/events/schemas/event-team-chat.schema.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { EventTeamChatSchema } from './event-team-chat.schema';

describe('EventTeamChat schema', () => {
  it('has eventId, team, archived paths with archived default false', () => {
    const paths = Object.keys(EventTeamChatSchema.paths);
    expect(paths).toEqual(expect.arrayContaining(['eventId', 'team', 'archived']));
    const archived: any = EventTeamChatSchema.path('archived');
    expect(archived.options.default).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/events/schemas/event-team-chat.schema.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventTeamChatDocument = HydratedDocument<EventTeamChat>;

@Schema({ timestamps: true })
export class EventTeamChat {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ required: true })
  team: string;

  @Prop({ default: false })
  archived: boolean;
}

export const EventTeamChatSchema = SchemaFactory.createForClass(EventTeamChat);
EventTeamChatSchema.index({ eventId: 1, team: 1 }, { unique: true });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/events/schemas/event-team-chat.schema.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/events/schemas/event-team-chat.schema.ts src/events/schemas/event-team-chat.schema.spec.ts
git commit -m "feat(events): EventTeamChat schema for preparation team rooms"
```
End with the Co-Authored-By trailer.

---

## Task 4: DTOs — update-status, submit-result, create-event extension

**Files:**
- Create: `src/events/dto/update-status.dto.ts`
- Create: `src/events/dto/submit-result.dto.ts`
- Modify: `src/events/dto/create-event.dto.ts`

- [ ] **Step 1: Create `src/events/dto/update-status.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { EVENT_STATUSES } from '../events.lifecycle';

export class UpdateStatusDto {
  @ApiProperty({ enum: EVENT_STATUSES, example: 'before_match' })
  @IsIn([...EVENT_STATUSES])
  status: string;
}
```

- [ ] **Step 2: Create `src/events/dto/submit-result.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class SubmitResultDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  scoreA: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(0)
  scoreB: number;

  @ApiProperty({ required: false, description: 'userId of the MVP (must be a joined player)' })
  @IsOptional()
  @IsMongoId()
  mvpUserId?: string;
}
```

- [ ] **Step 3: Extend `src/events/dto/create-event.dto.ts`**

Read the file first. Add these optional fields (do not change existing ones):

```ts
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsMongoId()
  templateId?: string;
```
(Add `IsDateString`, `IsMongoId`, `IsOptional` to the existing `class-validator` import if not present.)

- [ ] **Step 4: Verify DTOs compile**

Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' | grep -E 'dto/(update-status|submit-result|create-event)' || echo "dtos compile"`
Expected: `dtos compile` (remaining errors are in events.service/shuffle, fixed next).

- [ ] **Step 5: Commit**

```bash
git add src/events/dto/update-status.dto.ts src/events/dto/submit-result.dto.ts src/events/dto/create-event.dto.ts
git commit -m "feat(events): add update-status + submit-result DTOs, extend create-event"
```
End with the Co-Authored-By trailer.

---

## Task 5: EventsService — re-gate join/leave, add updateStatus/submitResult/addPhotos

**Files:**
- Modify: `src/events/events.service.ts`
- Modify: `src/events/events.module.ts` (register EventTeamChat model)
- Test: `src/events/events.service.spec.ts` (create)

**Context — current behavior being replaced:**
- `join()` gates on `status: 'open'` and toggles `status` to `'full'` at capacity. Change: gate on `status: 'join'`; do NOT set any `full` status (capacity is derived). Keep the atomic `$inc` guard.
- `leave()` reopens `full → open`. Change: gate on `status: 'join'`; just decrement `joinedCount` and cancel the player; no status change.
- Add: `updateStatus`, `submitResult`, `addPhotos`, plus a shared `assertOrganizer` helper (mirrors the ownership check already in `create()` and shuffle).

- [ ] **Step 1: Write the failing test**

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { EventsService } from './events.service';
import { Event } from './schemas/event.schema';
import { EventPlayer } from './schemas/event-player.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { EventTeamChat } from './schemas/event-team-chat.schema';

describe('EventsService lifecycle', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};
  const teamChatModel: any = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(EventTeamChat.name), useValue: teamChatModel },
      ],
    }).compile();
    service = m.get(EventsService);
  });

  it('updateStatus rejects an illegal transition', async () => {
    eventModel.findById = jest.fn().mockResolvedValue({
      _id: 'e1', status: 'join', createdBy: { toString: () => 'u1' }, groupId: null,
    });
    await expect(
      service.updateStatus('e1', 'u1', 'playing'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateStatus applies a legal transition', async () => {
    eventModel.findById = jest.fn().mockResolvedValue({
      _id: 'e1', status: 'join', createdBy: { toString: () => 'u1' }, groupId: null,
    });
    eventModel.findByIdAndUpdate = jest.fn().mockResolvedValue({ _id: 'e1', status: 'before_match' });
    const res = await service.updateStatus('e1', 'u1', 'before_match');
    expect(eventModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'e1', { $set: { status: 'before_match' } }, { new: true },
    );
    expect(res.status).toBe('before_match');
  });

  it('submitResult rejects when not in after_match', async () => {
    eventModel.findById = jest.fn().mockResolvedValue({
      _id: 'e1', status: 'playing', createdBy: { toString: () => 'u1' }, groupId: null,
    });
    await expect(
      service.submitResult('e1', 'u1', { scoreA: 1, scoreB: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/events/events.service.spec.ts`
Expected: FAIL — methods don't exist / constructor lacks EventTeamChat.

- [ ] **Step 3: Edit `events.service.ts`**

Add imports:
```ts
import { EventTeamChat, EventTeamChatDocument } from './schemas/event-team-chat.schema';
import { canTransition, EventStatus } from './events.lifecycle';
import { UpdateStatusDto } from './dto/update-status.dto';
import { SubmitResultDto } from './dto/submit-result.dto';
```
Add to the constructor:
```ts
    @InjectModel(EventTeamChat.name) private teamChatModel: Model<EventTeamChatDocument>,
```

Add a private ownership helper (reuses the existing logic pattern from `create()`):
```ts
  private async assertOrganizer(event: EventDocument, userId: string) {
    if (event.groupId) {
      const member = await this.memberModel.findOne({
        groupId: event.groupId,
        userId: new Types.ObjectId(userId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      if (!member) throw new ForbiddenException('Only group owner or admin can manage this event');
    } else if (event.createdBy.toString() !== userId) {
      throw new ForbiddenException('Only the event creator can manage this event');
    }
  }
```

Change `join()`: replace the filter `status: 'open'` with `status: 'join'`, and REMOVE the block that sets status to `'full'` at capacity (lines that do `findByIdAndUpdate(..., { status: 'full' })`). The error message branch should read: if the event's status is not `join` → 'Registration is closed'; else → 'Event is full'.

Change `leave()`: replace the update that reopened `full → open` with a plain guarded decrement that does NOT change status. New body:
```ts
  async leave(eventId: string, userId: string) {
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== 'join') {
      throw new BadRequestException('Cannot leave after registration has closed');
    }
    const player = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
      status: 'joined',
    });
    if (!player) throw new NotFoundException('You have not joined this event');
    player.status = 'cancelled';
    await player.save();
    await this.eventModel.findByIdAndUpdate(eventId, { $inc: { joinedCount: -1 } });
    return { message: 'Left event successfully' };
  }
```

Add the three new methods:
```ts
  async updateStatus(eventId: string, userId: string, next: string) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    await this.assertOrganizer(event as unknown as EventDocument, userId);
    if (!canTransition(event.status as EventStatus, next as EventStatus)) {
      throw new BadRequestException(`Illegal transition ${event.status} -> ${next}`);
    }
    if (next === 'done') {
      await this.teamChatModel.updateMany({ eventId: new Types.ObjectId(eventId) }, { $set: { archived: true } });
    }
    return this.eventModel.findByIdAndUpdate(eventId, { $set: { status: next } }, { new: true });
  }

  async submitResult(eventId: string, userId: string, dto: SubmitResultDto) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    await this.assertOrganizer(event as unknown as EventDocument, userId);
    if (event.status !== 'after_match') {
      throw new BadRequestException('Results can only be submitted in the after_match phase');
    }
    if (dto.mvpUserId) {
      const mvp = await this.playerModel.findOne({
        eventId: new Types.ObjectId(eventId),
        userId: new Types.ObjectId(dto.mvpUserId),
        status: 'joined',
      });
      if (!mvp) throw new BadRequestException('MVP must be a joined player of this event');
    }
    return this.eventModel.findByIdAndUpdate(
      eventId,
      { $set: { result: {
        scoreA: dto.scoreA,
        scoreB: dto.scoreB,
        mvpUserId: dto.mvpUserId ? new Types.ObjectId(dto.mvpUserId) : null,
      } } },
      { new: true },
    );
  }

  async addPhotos(eventId: string, userId: string, paths: string[]) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    await this.assertOrganizer(event as unknown as EventDocument, userId);
    if (event.status !== 'after_match' && event.status !== 'done') {
      throw new BadRequestException('Photos can only be added after the match');
    }
    return this.eventModel.findByIdAndUpdate(
      eventId,
      { $push: { photos: { $each: paths } } },
      { new: true },
    );
  }
```

Also update `list()`'s default query: it currently returns `{ isPublic: true }` regardless of status — leave as-is (discovery/geo is a separate plan), but ensure it still compiles.

- [ ] **Step 4: Register the model in `events.module.ts`**

Read the file; add `{ name: EventTeamChat.name, schema: EventTeamChatSchema }` to the `MongooseModule.forFeature([...])` array and import them.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/events/events.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/events/events.service.ts src/events/events.service.spec.ts src/events/events.module.ts
git commit -m "feat(events): lifecycle transitions, re-gated join/leave, results + photos"
```
End with the Co-Authored-By trailer.

---

## Task 6: EventsController — status/result/photos/cover routes

**Files:**
- Modify: `src/events/events.controller.ts`
- Modify: `src/events/events.controller.spec.ts` (create if absent)

**Context:** existing routes: `GET /events`, `POST /events`, `GET /events/:id`, `POST /events/:id/join`, `DELETE /events/:id/join`, `GET /events/:id/players`. All guarded by `JwtAuthGuard`. Add the new routes; keep existing ones.

- [ ] **Step 1: Add routes to the controller**

**Upload convention (verified against the codebase):** the shared config exports `multerDiskOptions(subDir: string)` (a factory), NOT a `multerConfig` constant. The groups wallpaper upload uses `@UseInterceptors(FileInterceptor('file', multerDiskOptions('groups')))` and stores the **bare `file.filename`** (not a `/uploads/...` prefix). Match that exactly: use `multerDiskOptions('events')` and store `file.filename`. Note this config only accepts image MIME types (jpeg/png/webp, 5MB) — fine for cover + after-match photos; it cannot handle video (chat video uploads are a separate §4.9 plan).

Add imports:
```ts
import { Patch, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { multerDiskOptions } from '../common/upload/multer.config';
import { UpdateStatusDto } from './dto/update-status.dto';
import { SubmitResultDto } from './dto/submit-result.dto';
```
Add methods:
```ts
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateStatusDto) {
    return this.eventsService.updateStatus(id, user._id.toString(), dto.status);
  }

  @Post(':id/result')
  submitResult(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: SubmitResultDto) {
    return this.eventsService.submitResult(id, user._id.toString(), dto);
  }

  @Post(':id/photos')
  @UseInterceptors(FilesInterceptor('files', 10, multerDiskOptions('events')))
  addPhotos(@Param('id') id: string, @CurrentUser() user: any, @UploadedFiles() files: Express.Multer.File[]) {
    const paths = (files ?? []).map((f) => f.filename);
    return this.eventsService.addPhotos(id, user._id.toString(), paths);
  }
```

For the cover image, add `POST :id/cover` using `FileInterceptor('file', multerDiskOptions('events'))` that sets `coverImage` to `file.filename`. Add a small `setCover(eventId, userId, path)` to the service mirroring `addPhotos` (organizer-gated, any status). Implement `setCover` in the service for symmetry:
```ts
  async setCover(eventId: string, userId: string, path: string) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    await this.assertOrganizer(event as unknown as EventDocument, userId);
    return this.eventModel.findByIdAndUpdate(eventId, { $set: { coverImage: path } }, { new: true });
  }
```
Controller:
```ts
  @Post(':id/cover')
  @UseInterceptors(FileInterceptor('file', multerDiskOptions('events')))
  setCover(@Param('id') id: string, @CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    return this.eventsService.setCover(id, user._id.toString(), file.filename);
  }
```
(`UploadedFile` is already in the import list above.)

- [ ] **Step 2: Update/create the controller spec**

Provide a mocked `EventsService` and assert each new route delegates with the right args:
```ts
import { Test } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

describe('EventsController lifecycle routes', () => {
  let controller: EventsController;
  const svc = {
    updateStatus: jest.fn().mockResolvedValue({ status: 'before_match' }),
    submitResult: jest.fn().mockResolvedValue({}),
    addPhotos: jest.fn().mockResolvedValue({}),
    setCover: jest.fn().mockResolvedValue({}),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventsService, useValue: svc }],
    }).compile();
    controller = m.get(EventsController);
  });
  it('PATCH status delegates', async () => {
    await controller.updateStatus('e1', { _id: 'u1' } as any, { status: 'before_match' } as any);
    expect(svc.updateStatus).toHaveBeenCalledWith('e1', 'u1', 'before_match');
  });
  it('POST result delegates', async () => {
    await controller.submitResult('e1', { _id: 'u1' } as any, { scoreA: 1, scoreB: 0 } as any);
    expect(svc.submitResult).toHaveBeenCalledWith('e1', 'u1', { scoreA: 1, scoreB: 0 });
  });
});
```
(If the existing controller spec fully mocks the service, extend it instead of replacing.)

- [ ] **Step 3: Run tests + build**

Run: `npx jest src/events/events.controller.spec.ts`
Expected: PASS.
Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' | grep -v src/shuffle/ || echo "events build green"`
Expected: `events build green` (shuffle fixed in Task 7).

- [ ] **Step 4: Commit**

```bash
git add src/events/events.controller.ts src/events/events.controller.spec.ts
git commit -m "feat(events): status/result/photos/cover endpoints"
```
End with the Co-Authored-By trailer.

---

## Task 7: Shuffle — gate to preparation, create team-chat rooms

**Files:**
- Modify: `src/shuffle/shuffle.service.ts`
- Modify: `src/shuffle/shuffle.module.ts` (register EventTeamChat model)
- Test: `src/shuffle/shuffle.service.spec.ts` (create)

**Context:** current `shuffle()` authorizes, fetches joined players, Fisher-Yates into groups of 6, writes `team` strings, notifies. Changes: (1) reject unless `event.status === 'preparation'`; (2) after assigning teams, upsert one `EventTeamChat` per distinct team number; keep the notification.

- [ ] **Step 1: Write the failing test**

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { ShuffleService } from './shuffle.service';
import { Event } from '../events/schemas/event.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { EventTeamChat } from '../events/schemas/event-team-chat.schema';
import { NotificationsService } from '../notifications/notifications.service';

describe('ShuffleService', () => {
  let service: ShuffleService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};
  const teamChatModel: any = { bulkWrite: jest.fn().mockResolvedValue({}) };
  const notifications = { create: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        ShuffleService,
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: getModelToken(EventTeamChat.name), useValue: teamChatModel },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = m.get(ShuffleService);
  });

  it('rejects shuffle when event is not in preparation', async () => {
    eventModel.findById = jest.fn().mockResolvedValue({
      _id: 'e1', status: 'join', groupId: null, createdBy: { toString: () => 'u1' },
    });
    await expect(service.shuffle('e1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shuffle/shuffle.service.spec.ts`
Expected: FAIL — no preparation gate / constructor lacks EventTeamChat.

- [ ] **Step 3: Edit `shuffle.service.ts`**

Add imports:
```ts
import { BadRequestException } from '@nestjs/common';
import { EventTeamChat, EventTeamChatDocument } from '../events/schemas/event-team-chat.schema';
```
Add to constructor:
```ts
    @InjectModel(EventTeamChat.name) private teamChatModel: Model<EventTeamChatDocument>,
```
After the ownership check and before fetching players, add:
```ts
    if (event.status !== 'preparation') {
      throw new BadRequestException('Shuffle is only allowed during the preparation phase');
    }
```
After `bulkWrite` of player teams, create the team-chat rooms (idempotent upsert per distinct team):
```ts
    const teamNumbers = [...new Set(shuffled.map((_, i) => Math.floor(i / GROUP_SIZE) + 1))];
    if (teamNumbers.length > 0) {
      await this.teamChatModel.bulkWrite(
        teamNumbers.map((n) => ({
          updateOne: {
            filter: { eventId: new Types.ObjectId(eventId), team: String(n) },
            update: { $setOnInsert: { eventId: new Types.ObjectId(eventId), team: String(n), archived: false } },
            upsert: true,
          },
        })),
      );
    }
```

- [ ] **Step 4: Register model in `shuffle.module.ts`**

Read the file; add `{ name: EventTeamChat.name, schema: EventTeamChatSchema }` to `MongooseModule.forFeature`.

- [ ] **Step 5: Run test + build**

Run: `npx jest src/shuffle/shuffle.service.spec.ts`
Expected: PASS.
Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' || echo BUILD_GREEN`
Expected: BUILD_GREEN.

- [ ] **Step 6: Commit**

```bash
git add src/shuffle/shuffle.service.ts src/shuffle/shuffle.service.spec.ts src/shuffle/shuffle.module.ts
git commit -m "feat(shuffle): gate to preparation phase, scaffold team-chat rooms"
```
End with the Co-Authored-By trailer.

---

## Task 8: Full gate + existing-test reconciliation

**Files:** possibly `test/events.e2e-spec.ts` and any test asserting the old `open/full/done` statuses.

- [ ] **Step 1: Find tests referencing the old statuses**

Run: `grep -rn "'open'\|'full'\|status.*open\|status.*full" test src/events | grep -iv lifecycle`
For each hit that assumes the old capacity model, update it to the new lifecycle (e.g. a newly created event's status is now `join`, not `open`; joining a full event no longer flips status to `full`).

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest`
Expected: all pass. Fix any breakage caused by the status rename (the e2e `events.e2e-spec.ts` likely asserts `open`).

- [ ] **Step 3: Build + lint (scoped, no repo-wide --fix)**

Run: `rm -f dist/tsconfig.build.tsbuildinfo; npm run build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep 'error TS' || echo BUILD_GREEN`
Run: `npx eslint --fix src/events src/shuffle` (scope to touched dirs only — do NOT run repo-wide `npm run lint`, which reformats unrelated files).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(events): reconcile existing tests with lifecycle status rename"
```
End with the Co-Authored-By trailer.

---

## Self-Review Notes (addressed)

- **Spec coverage (§4.5):** 6-state lifecycle (Task 1–2), Join/Unjoin gating (Task 5), Preparation shuffle + team chats (Task 3, 7), After Match results + MVP + photos (Task 5–6), cover image (Task 6), match date/time split via `startTime`/`endTime` (Task 2, 4), template prefill hook via `templateId` (Task 2, 4). "Playing" and "Done" are states with organizer transitions; "Done" archives team chats (Task 5).
- **Explicitly deferred (documented above):** event-template CRUD store, player ratings (§4.10), geo/public discovery (§4.6), full real-time event team chat. These are separate plans; this plan only lays their hooks (`templateId`, `after_match` state, `EventTeamChat` rooms).
- **Type consistency:** `updateStatus(eventId, userId, next)`, `submitResult(eventId, userId, dto)`, `addPhotos(eventId, userId, paths)`, `setCover(eventId, userId, path)` — signatures match between service, controller, and tests. Status strings come from the single `EVENT_STATUSES` source (lifecycle module) used by schema, DTO, and service.
- **Capacity model:** `full` status removed everywhere; join gated on `join` state + atomic `$inc` capacity guard; leave gated on `join` state. Verify Task 8 catches any test still asserting `full`.
- **Multer (verified):** the config exports `multerDiskOptions(subDir)`, and controllers store the bare `file.filename`. Task 6 uses `multerDiskOptions('events')` and stores `file.filename`, matching the groups wallpaper convention. The config is image-only (jpeg/png/webp, 5MB) — sufficient for cover + photos.

---

## Suggested next plans (after this one)

1. **Player Ratings (§4.10)** — now unblocked (the `after_match` state exists). Rate teammates 1–5 + comment, gated to `after_match`, one per teammate per match.
2. **Event Templates store** — `POST/GET /event-templates`; `create()` already accepts `templateId`.
3. **Public/geo discovery (§4.6)** — 2dsphere index, `GET /events?near=&radius=`.
