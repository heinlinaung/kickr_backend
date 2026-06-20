# KicKR Backend Plan B — Groups, Chat, Events, Tournaments, Shuffle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Groups (create/update/wallpaper), Group Invitations (name search + QR code + approval), real-time Group Chat (Socket.io + REST history), Events (create/join/leave), Tournaments (create/register team/update score), and Player Shuffle (Fisher-Yates, 6-per-group).

**Architecture:** Each feature is a NestJS module. Groups owns membership. Chat uses a Socket.io gateway with JWT handshake auth. Invitations are stored in `group_members` with `status: "pending"`. QR invite code is a short-lived token stored on the group document. All modules import `UsersModule` for the User schema.

**Prerequisite:** Plan A must be fully implemented and all its e2e tests passing before starting Plan B.

**Tech Stack:** NestJS ^10, Mongoose ^8, @nestjs/websockets, socket.io, class-validator, Jest/supertest (already installed from Plan A).

**Spec:** `docs/superpowers/specs/2026-06-20-kickr-backend-design.md`

---

## File Map

```
src/
├── groups/
│   ├── groups.module.ts
│   ├── groups.controller.ts
│   ├── groups.service.ts
│   ├── schemas/
│   │   ├── group.schema.ts
│   │   └── group-member.schema.ts
│   └── dto/
│       ├── create-group.dto.ts
│       └── update-group.dto.ts
├── invitations/
│   ├── invitations.module.ts
│   ├── invitations.controller.ts
│   ├── invitations.service.ts
│   └── dto/respond-invitation.dto.ts
├── chat/
│   ├── chat.module.ts
│   ├── chat.gateway.ts
│   ├── chat.service.ts
│   └── schemas/message.schema.ts
├── events/
│   ├── events.module.ts
│   ├── events.controller.ts
│   ├── events.service.ts
│   ├── schemas/
│   │   ├── event.schema.ts
│   │   └── event-player.schema.ts
│   └── dto/create-event.dto.ts
├── tournaments/
│   ├── tournaments.module.ts
│   ├── tournaments.controller.ts
│   ├── tournaments.service.ts
│   ├── schemas/
│   │   ├── tournament.schema.ts
│   │   ├── tournament-team.schema.ts
│   │   └── tournament-match.schema.ts
│   └── dto/
│       ├── create-tournament.dto.ts
│       ├── register-team.dto.ts
│       └── update-match.dto.ts
├── shuffle/
│   ├── shuffle.module.ts
│   ├── shuffle.controller.ts
│   └── shuffle.service.ts
└── notifications/
    ├── notifications.module.ts
    ├── notifications.controller.ts
    ├── notifications.service.ts
    └── schemas/notification.schema.ts
test/
├── groups.e2e-spec.ts
├── events.e2e-spec.ts
└── tournaments.e2e-spec.ts
```

---

## Task 8: Schemas for Groups, Events, Tournaments

**Files:**
- Create: `src/groups/schemas/group.schema.ts`
- Create: `src/groups/schemas/group-member.schema.ts`
- Create: `src/chat/schemas/message.schema.ts`
- Create: `src/events/schemas/event.schema.ts`
- Create: `src/events/schemas/event-player.schema.ts`
- Create: `src/tournaments/schemas/tournament.schema.ts`
- Create: `src/tournaments/schemas/tournament-team.schema.ts`
- Create: `src/tournaments/schemas/tournament-match.schema.ts`
- Create: `src/notifications/schemas/notification.schema.ts`

- [ ] **Step 1: Create schema directories**

```bash
mkdir -p src/groups/schemas src/chat/schemas src/events/schemas \
          src/tournaments/schemas src/notifications/schemas
```

- [ ] **Step 2: Write group schema**

```typescript
// src/groups/schemas/group.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GroupDocument = Group & Document;

@Schema({ timestamps: true })
export class Group {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  ownerId: Types.ObjectId;

  @Prop()
  wallpaper: string;

  @Prop()
  locationName: string;

  @Prop()
  latitude: number;

  @Prop()
  longitude: number;

  @Prop({ default: false })
  isPrivate: boolean;

  @Prop({ default: 22 })
  maxPlayers: number;

  @Prop()
  inviteCode: string;

  @Prop()
  inviteCodeExpiry: Date;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
```

- [ ] **Step 3: Write group-member schema**

```typescript
// src/groups/schemas/group-member.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GroupMemberDocument = GroupMember & Document;

@Schema({ timestamps: true })
export class GroupMember {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Group' })
  groupId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ default: 'member', enum: ['owner', 'admin', 'member'] })
  role: string;

  @Prop({ default: 'pending', enum: ['pending', 'approved'] })
  status: string;

  @Prop()
  joinedAt: Date;
}

export const GroupMemberSchema = SchemaFactory.createForClass(GroupMember);
GroupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });
```

- [ ] **Step 4: Write message schema**

```typescript
// src/chat/schemas/message.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Group' })
  groupId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  senderId: Types.ObjectId;

  @Prop({ required: true })
  text: string;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ groupId: 1, createdAt: -1 });
```

- [ ] **Step 5: Write event schema**

```typescript
// src/events/schemas/event.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EventDocument = Event & Document;

@Schema({ timestamps: true })
export class Event {
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  @Prop({ default: false })
  isPublic: boolean;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop()
  locationName: string;

  @Prop()
  latitude: number;

  @Prop()
  longitude: number;

  @Prop({ default: 12 })
  maxPlayers: number;

  @Prop({ default: 0 })
  joinedCount: number;

  @Prop({ default: 'football', enum: ['football', 'futsal'] })
  sportType: string;

  @Prop({ default: 'beginner', enum: ['beginner', 'intermediate', 'advanced'] })
  skillLevel: string;

  @Prop({ default: 0 })
  price: number;

  @Prop({ default: 'open', enum: ['open', 'full', 'done'] })
  status: string;
}

export const EventSchema = SchemaFactory.createForClass(Event);
```

- [ ] **Step 6: Write event-player schema**

```typescript
// src/events/schemas/event-player.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EventPlayerDocument = EventPlayer & Document;

@Schema({ timestamps: true })
export class EventPlayer {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop()
  joinedAt: Date;

  @Prop({ default: null })
  team: string | null;

  @Prop()
  position: string;

  @Prop({ default: 'joined', enum: ['joined', 'cancelled'] })
  status: string;

  @Prop()
  checkInTime: Date;
}

export const EventPlayerSchema = SchemaFactory.createForClass(EventPlayer);
EventPlayerSchema.index({ eventId: 1, userId: 1 }, { unique: true });
```

- [ ] **Step 7: Write tournament schema**

```typescript
// src/tournaments/schemas/tournament.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TournamentDocument = Tournament & Document;

@Schema({ timestamps: true })
export class Tournament {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  @Prop({ required: true, enum: ['knockout', 'league'] })
  type: string;

  @Prop({ required: true })
  maxTeams: number;

  @Prop({ default: 0 })
  currentTeams: number;

  @Prop({ default: 'registering', enum: ['registering', 'ongoing', 'finished'] })
  status: string;

  @Prop()
  startDate: Date;
}

export const TournamentSchema = SchemaFactory.createForClass(Tournament);
```

- [ ] **Step 8: Write tournament-team schema**

```typescript
// src/tournaments/schemas/tournament-team.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TournamentTeamDocument = TournamentTeam & Document;

@Schema({ timestamps: true })
export class TournamentTeam {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  players: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  captainId: Types.ObjectId;
}

export const TournamentTeamSchema = SchemaFactory.createForClass(TournamentTeam);
```

- [ ] **Step 9: Write tournament-match schema**

```typescript
// src/tournaments/schemas/tournament-match.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TournamentMatchDocument = TournamentMatch & Document;

@Schema({ timestamps: true })
export class TournamentMatch {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ required: true })
  round: number;

  @Prop({ required: true })
  matchNumber: number;

  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  teamAId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  teamBId: Types.ObjectId | null;

  @Prop({ default: 0 })
  scoreA: number;

  @Prop({ default: 0 })
  scoreB: number;

  @Prop({ type: Types.ObjectId, ref: 'TournamentTeam', default: null })
  winnerId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'TournamentMatch', default: null })
  nextMatchId: Types.ObjectId | null;

  @Prop()
  scheduledAt: Date;
}

export const TournamentMatchSchema = SchemaFactory.createForClass(TournamentMatch);
```

- [ ] **Step 10: Write notification schema**

```typescript
// src/notifications/schemas/notification.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ required: true, enum: ['event', 'group'] })
  type: string;

  @Prop()
  refId: string;

  @Prop({ default: false })
  isRead: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, createdAt: -1 });
```

- [ ] **Step 11: Commit all schemas**

```bash
git add src/groups/schemas/ src/chat/schemas/ src/events/schemas/ \
        src/tournaments/schemas/ src/notifications/schemas/
git commit -m "feat: add Mongoose schemas for groups, chat, events, tournaments, notifications"
```

---

## Task 9: Notifications Module

**Files:**
- Create: `src/notifications/notifications.service.ts`
- Create: `src/notifications/notifications.controller.ts`
- Create: `src/notifications/notifications.module.ts`

- [ ] **Step 1: Write notifications service**

```typescript
// src/notifications/notifications.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private notifModel: Model<NotificationDocument>,
  ) {}

  async create(data: {
    userId: string;
    title: string;
    body: string;
    type: 'event' | 'group';
    refId: string;
  }) {
    return this.notifModel.create({ ...data, userId: new Types.ObjectId(data.userId) });
  }

  async findForUser(userId: string) {
    return this.notifModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ isRead: 1, createdAt: -1 })
      .lean();
  }

  async markRead(notifId: string, userId: string) {
    return this.notifModel.findOneAndUpdate(
      { _id: notifId, userId: new Types.ObjectId(userId) },
      { $set: { isRead: true } },
      { new: true },
    );
  }

  async markAllRead(userId: string) {
    await this.notifModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true } },
    );
    return { message: 'All notifications marked as read' };
  }
}
```

- [ ] **Step 2: Write notifications controller**

```typescript
// src/notifications/notifications.controller.ts
import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { UserDocument } from '../users/schemas/user.schema';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: UserDocument) {
    return this.notificationsService.findForUser((user._id as any).toString());
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: UserDocument) {
    return this.notificationsService.markRead(id, (user._id as any).toString());
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: UserDocument) {
    return this.notificationsService.markAllRead((user._id as any).toString());
  }
}
```

- [ ] **Step 3: Write notifications module**

```typescript
// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationSchema } from './schemas/notification.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 4: Add NotificationsModule to app.module.ts**

```typescript
// src/app.module.ts — add to imports array:
import { NotificationsModule } from './notifications/notifications.module';
// ...
imports: [
  // ...existing imports...
  NotificationsModule,
],
```

- [ ] **Step 5: Commit notifications module**

```bash
git add src/notifications/ src/app.module.ts
git commit -m "feat: add notifications module"
```

---

## Task 10: Groups Module (Create, Update, Wallpaper, Members)

**Files:**
- Create: `src/groups/dto/create-group.dto.ts`
- Create: `src/groups/dto/update-group.dto.ts`
- Create: `src/groups/groups.service.ts`
- Create: `src/groups/groups.controller.ts`
- Create: `src/groups/groups.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create DTO directory**

```bash
mkdir -p src/groups/dto
```

- [ ] **Step 2: Write create-group DTO**

```typescript
// src/groups/dto/create-group.dto.ts
import { IsString, IsOptional, IsBoolean, IsNumber, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGroupDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;
}
```

- [ ] **Step 3: Write update-group DTO**

```typescript
// src/groups/dto/update-group.dto.ts
import { IsString, IsOptional, IsNumber, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;
}
```

- [ ] **Step 4: Write groups service**

```typescript
// src/groups/groups.service.ts
import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Group, GroupDocument } from './schemas/group.schema';
import { GroupMember, GroupMemberDocument } from './schemas/group-member.schema';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
  ) {}

  async create(ownerId: string, dto: CreateGroupDto): Promise<GroupDocument> {
    const group = await this.groupModel.create({
      ...dto,
      ownerId: new Types.ObjectId(ownerId),
    });
    await this.memberModel.create({
      groupId: group._id,
      userId: new Types.ObjectId(ownerId),
      role: 'owner',
      status: 'approved',
      joinedAt: new Date(),
    });
    return group;
  }

  async findById(groupId: string): Promise<GroupDocument> {
    const group = await this.groupModel.findById(groupId).lean();
    if (!group) throw new NotFoundException('Group not found');
    return group as GroupDocument;
  }

  async update(groupId: string, userId: string, dto: UpdateGroupDto): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);
    const group = await this.groupModel
      .findByIdAndUpdate(groupId, { $set: dto }, { new: true })
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group as GroupDocument;
  }

  async updateWallpaper(groupId: string, userId: string, filename: string): Promise<GroupDocument> {
    await this.assertOwnerOrAdmin(groupId, userId);
    const group = await this.groupModel
      .findByIdAndUpdate(
        groupId,
        { $set: { wallpaper: `/uploads/groups/${filename}` } },
        { new: true },
      )
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return group as GroupDocument;
  }

  async listMembers(groupId: string) {
    return this.memberModel
      .find({ groupId: new Types.ObjectId(groupId), status: 'approved' })
      .populate('userId', 'name email profileImage')
      .lean();
  }

  async removeMember(groupId: string, requesterId: string, targetUserId: string) {
    await this.assertOwnerOrAdmin(groupId, requesterId);
    await this.memberModel.deleteOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(targetUserId),
    });
    return { message: 'Member removed' };
  }

  async generateInviteCode(groupId: string, userId: string): Promise<string> {
    await this.assertOwnerOrAdmin(groupId, userId);
    const code = uuidv4();
    await this.groupModel.findByIdAndUpdate(groupId, {
      $set: {
        inviteCode: code,
        inviteCodeExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      },
    });
    return code;
  }

  async getMemberRole(groupId: string, userId: string): Promise<string | null> {
    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
    });
    return member?.role ?? null;
  }

  private async assertOwnerOrAdmin(groupId: string, userId: string) {
    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
      role: { $in: ['owner', 'admin'] },
    });
    if (!member) throw new ForbiddenException('Only group owner or admin can perform this action');
  }
}
```

- [ ] **Step 5: Write groups controller**

```typescript
// src/groups/groups.controller.ts
import {
  Controller, Post, Get, Patch, Delete, Body, Param, UseGuards,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { multerDiskOptions } from '../common/upload/multer.config';
import { UserDocument } from '../users/schemas/user.schema';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Post()
  create(@CurrentUser() user: UserDocument, @Body() dto: CreateGroupDto) {
    return this.groupsService.create((user._id as any).toString(), dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.groupsService.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(id, (user._id as any).toString(), dto);
  }

  @Post(':id/wallpaper')
  @UseInterceptors(FileInterceptor('file', multerDiskOptions('groups')))
  uploadWallpaper(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.groupsService.updateWallpaper(id, (user._id as any).toString(), file.filename);
  }

  @Get(':id/members')
  listMembers(@Param('id') id: string) {
    return this.groupsService.listMembers(id);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') groupId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: UserDocument,
  ) {
    return this.groupsService.removeMember(groupId, (user._id as any).toString(), targetUserId);
  }

  @Get(':id/invite-code')
  getInviteCode(@Param('id') id: string, @CurrentUser() user: UserDocument) {
    return this.groupsService.generateInviteCode(id, (user._id as any).toString())
      .then((code) => ({ inviteCode: code }));
  }
}
```

- [ ] **Step 6: Write groups module**

```typescript
// src/groups/groups.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { Group, GroupSchema } from './schemas/group.schema';
import { GroupMember, GroupMemberSchema } from './schemas/group-member.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
    ]),
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService, MongooseModule],
})
export class GroupsModule {}
```

- [ ] **Step 7: Add GroupsModule to app.module.ts**

```typescript
// src/app.module.ts — add to imports:
import { GroupsModule } from './groups/groups.module';
// ...
imports: [
  // ...existing...
  GroupsModule,
],
```

- [ ] **Step 8: Commit groups module**

```bash
git add src/groups/ src/app.module.ts
git commit -m "feat: add groups module — create, update, wallpaper, members, invite code"
```

---

## Task 11: Invitations Module (Join Request + QR + Approval)

**Files:**
- Create: `src/invitations/dto/respond-invitation.dto.ts`
- Create: `src/invitations/invitations.service.ts`
- Create: `src/invitations/invitations.controller.ts`
- Create: `src/invitations/invitations.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/invitations/dto
```

- [ ] **Step 2: Write respond-invitation DTO**

```typescript
// src/invitations/dto/respond-invitation.dto.ts
import { IsEnum } from 'class-validator';

export class RespondInvitationDto {
  @IsEnum(['approved', 'rejected'])
  action: 'approved' | 'rejected';
}
```

- [ ] **Step 3: Write invitations service**

```typescript
// src/invitations/invitations.service.ts
import {
  Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { GroupMember, GroupMemberDocument } from '../groups/schemas/group-member.schema';
import { RespondInvitationDto } from './dto/respond-invitation.dto';

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
  ) {}

  async requestToJoin(groupId: string, userId: string) {
    const group = await this.groupModel.findById(groupId);
    if (!group) throw new NotFoundException('Group not found');

    const existing = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
    });
    if (existing) throw new ConflictException('Already a member or request pending');

    await this.memberModel.create({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      role: 'member',
      status: 'pending',
    });

    return { message: 'Join request sent. Waiting for approval.' };
  }

  async listPending(groupId: string, requesterId: string) {
    await this.assertOwnerOrAdmin(groupId, requesterId);
    return this.memberModel
      .find({ groupId: new Types.ObjectId(groupId), status: 'pending' })
      .populate('userId', 'name email profileImage')
      .lean();
  }

  async respond(groupId: string, invitationId: string, requesterId: string, dto: RespondInvitationDto) {
    await this.assertOwnerOrAdmin(groupId, requesterId);

    const invitation = await this.memberModel.findOne({
      _id: invitationId,
      groupId: new Types.ObjectId(groupId),
      status: 'pending',
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    if (dto.action === 'approved') {
      invitation.status = 'approved';
      invitation.joinedAt = new Date();
      await invitation.save();
      return { message: 'Member approved' };
    } else {
      await invitation.deleteOne();
      return { message: 'Invitation rejected' };
    }
  }

  async joinByCode(code: string, userId: string) {
    const group = await this.groupModel.findOne({
      inviteCode: code,
      inviteCodeExpiry: { $gt: new Date() },
    });
    if (!group) throw new BadRequestException('Invalid or expired invite code');

    const existing = await this.memberModel.findOne({
      groupId: group._id,
      userId: new Types.ObjectId(userId),
    });
    if (existing) throw new ConflictException('Already a member or request pending');

    await this.memberModel.create({
      groupId: group._id,
      userId: new Types.ObjectId(userId),
      role: 'member',
      status: 'approved',
      joinedAt: new Date(),
    });

    return { message: 'Joined group successfully', groupId: group._id };
  }

  private async assertOwnerOrAdmin(groupId: string, userId: string) {
    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
      role: { $in: ['owner', 'admin'] },
    });
    if (!member) throw new ForbiddenException('Only group owner or admin can perform this action');
  }
}
```

- [ ] **Step 4: Write invitations controller**

```typescript
// src/invitations/invitations.controller.ts
import { Controller, Post, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InvitationsService } from './invitations.service';
import { RespondInvitationDto } from './dto/respond-invitation.dto';
import { UserDocument } from '../users/schemas/user.schema';

@Controller()
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private invitationsService: InvitationsService) {}

  @Post('groups/:id/invitations')
  requestToJoin(@Param('id') groupId: string, @CurrentUser() user: UserDocument) {
    return this.invitationsService.requestToJoin(groupId, (user._id as any).toString());
  }

  @Get('groups/:id/invitations')
  listPending(@Param('id') groupId: string, @CurrentUser() user: UserDocument) {
    return this.invitationsService.listPending(groupId, (user._id as any).toString());
  }

  @Patch('groups/:id/invitations/:invId')
  respond(
    @Param('id') groupId: string,
    @Param('invId') invId: string,
    @CurrentUser() user: UserDocument,
    @Body() dto: RespondInvitationDto,
  ) {
    return this.invitationsService.respond(groupId, invId, (user._id as any).toString(), dto);
  }

  @Post('groups/join-by-code')
  joinByCode(@Body('code') code: string, @CurrentUser() user: UserDocument) {
    return this.invitationsService.joinByCode(code, (user._id as any).toString());
  }
}
```

- [ ] **Step 5: Write invitations module**

```typescript
// src/invitations/invitations.module.ts
import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { GroupsModule } from '../groups/groups.module';

@Module({
  imports: [GroupsModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
```

- [ ] **Step 6: Add InvitationsModule to app.module.ts**

```typescript
// src/app.module.ts — add to imports:
import { InvitationsModule } from './invitations/invitations.module';
// ...
imports: [
  // ...existing...
  InvitationsModule,
],
```

- [ ] **Step 7: Commit invitations module**

```bash
git add src/invitations/ src/app.module.ts
git commit -m "feat: add invitations module — join request, QR join, approval flow"
```

---

## Task 12: Chat Module (Socket.io + REST History)

**Files:**
- Create: `src/chat/chat.service.ts`
- Create: `src/chat/chat.gateway.ts`
- Create: `src/chat/chat.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Install Socket.io adapter**

```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
npm install -D @types/socket.io
```

- [ ] **Step 2: Write chat service**

```typescript
// src/chat/chat.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema';

@Injectable()
export class ChatService {
  constructor(@InjectModel(Message.name) private messageModel: Model<MessageDocument>) {}

  async saveMessage(groupId: string, senderId: string, text: string): Promise<MessageDocument> {
    return this.messageModel.create({
      groupId: new Types.ObjectId(groupId),
      senderId: new Types.ObjectId(senderId),
      text,
    });
  }

  async getHistory(groupId: string, limit = 50) {
    return this.messageModel
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('senderId', 'name profileImage')
      .lean();
  }
}
```

- [ ] **Step 3: Write chat gateway**

```typescript
// src/chat/chat.gateway.ts
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  MessageBody, ConnectedSocket, OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';

@WebSocketGateway({ cors: true, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.query.token as string;
      const payload = this.jwtService.verify(token);
      (client as any).userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() data: { groupId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.groupId);
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() data: { groupId: string; text: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = (client as any).userId;
    if (!userId) return;

    const message = await this.chatService.saveMessage(data.groupId, userId, data.text);
    this.server.to(data.groupId).emit('newMessage', {
      messageId: message._id,
      senderId: userId,
      text: message.text,
      createdAt: (message as any).createdAt,
    });
  }
}
```

- [ ] **Step 4: Write chat controller (history endpoint)**

```typescript
// src/chat/chat.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChatService } from './chat.service';

@Controller('groups/:id/messages')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get()
  getHistory(@Param('id') groupId: string, @Query('limit') limit?: string) {
    return this.chatService.getHistory(groupId, limit ? parseInt(limit, 10) : 50);
  }
}
```

- [ ] **Step 5: Write chat module**

```typescript
// src/chat/chat.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { Message, MessageSchema } from './schemas/message.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    AuthModule,
  ],
  controllers: [ChatController],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
```

- [ ] **Step 6: Add ChatModule to app.module.ts**

```typescript
// src/app.module.ts — add to imports:
import { ChatModule } from './chat/chat.module';
// ...
imports: [
  // ...existing...
  ChatModule,
],
```

- [ ] **Step 7: Commit chat module**

```bash
git add src/chat/ src/app.module.ts
git commit -m "feat: add chat module — Socket.io gateway and REST message history"
```

---

## Task 13: Events Module (Create, Join, Leave, List Players)

**Files:**
- Create: `src/events/dto/create-event.dto.ts`
- Create: `src/events/events.service.ts`
- Create: `src/events/events.controller.ts`
- Create: `src/events/events.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create DTO directory**

```bash
mkdir -p src/events/dto
```

- [ ] **Step 2: Write create-event DTO**

```typescript
// src/events/dto/create-event.dto.ts
import {
  IsString, IsOptional, IsBoolean, IsNumber, IsEnum, IsDateString, MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEventDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPlayers?: number;

  @IsOptional()
  @IsEnum(['football', 'futsal'])
  sportType?: string;

  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced'])
  skillLevel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;
}
```

- [ ] **Step 3: Write events service**

```typescript
// src/events/events.service.ts
import {
  Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Event, EventDocument } from './schemas/event.schema';
import { EventPlayer, EventPlayerDocument } from './schemas/event-player.schema';
import { GroupMember, GroupMemberDocument } from '../groups/schemas/group-member.schema';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class EventsService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name) private playerModel: Model<EventPlayerDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
  ) {}

  async list(userId: string) {
    return this.eventModel.find({ isPublic: true }).sort({ date: 1 }).lean();
  }

  async create(userId: string, dto: CreateEventDto): Promise<EventDocument> {
    if (dto.groupId) {
      const member = await this.memberModel.findOne({
        groupId: new Types.ObjectId(dto.groupId),
        userId: new Types.ObjectId(userId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      if (!member) throw new ForbiddenException('Only group owner or admin can create events');
    }
    return this.eventModel.create({
      ...dto,
      date: new Date(dto.date),
      groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : null,
      createdBy: new Types.ObjectId(userId),
    });
  }

  async findById(eventId: string): Promise<EventDocument> {
    const event = await this.eventModel.findById(eventId).lean();
    if (!event) throw new NotFoundException('Event not found');
    return event as EventDocument;
  }

  async join(eventId: string, userId: string) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== 'open') throw new BadRequestException('Event is not open for joining');
    if (event.joinedCount >= event.maxPlayers) throw new BadRequestException('Event is full');

    const existing = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
    });
    if (existing && existing.status === 'joined') throw new ConflictException('Already joined');
    if (existing && existing.status === 'cancelled') {
      existing.status = 'joined';
      existing.joinedAt = new Date();
      await existing.save();
    } else {
      await this.playerModel.create({
        eventId: new Types.ObjectId(eventId),
        userId: new Types.ObjectId(userId),
        joinedAt: new Date(),
        status: 'joined',
      });
    }

    await this.eventModel.findByIdAndUpdate(eventId, { $inc: { joinedCount: 1 } });
    if (event.joinedCount + 1 >= event.maxPlayers) {
      await this.eventModel.findByIdAndUpdate(eventId, { $set: { status: 'full' } });
    }

    return { message: 'Joined event successfully' };
  }

  async leave(eventId: string, userId: string) {
    const player = await this.playerModel.findOne({
      eventId: new Types.ObjectId(eventId),
      userId: new Types.ObjectId(userId),
      status: 'joined',
    });
    if (!player) throw new NotFoundException('You have not joined this event');

    player.status = 'cancelled';
    await player.save();
    await this.eventModel.findByIdAndUpdate(eventId, {
      $inc: { joinedCount: -1 },
      $set: { status: 'open' },
    });

    return { message: 'Left event successfully' };
  }

  async listPlayers(eventId: string) {
    return this.playerModel
      .find({ eventId: new Types.ObjectId(eventId), status: 'joined' })
      .populate('userId', 'name profileImage')
      .lean();
  }
}
```

- [ ] **Step 4: Write events controller**

```typescript
// src/events/events.controller.ts
import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UserDocument } from '../users/schemas/user.schema';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Get()
  list(@CurrentUser() user: UserDocument) {
    return this.eventsService.list((user._id as any).toString());
  }

  @Post()
  create(@CurrentUser() user: UserDocument, @Body() dto: CreateEventDto) {
    return this.eventsService.create((user._id as any).toString(), dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.eventsService.findById(id);
  }

  @Post(':id/join')
  join(@Param('id') id: string, @CurrentUser() user: UserDocument) {
    return this.eventsService.join(id, (user._id as any).toString());
  }

  @Delete(':id/join')
  leave(@Param('id') id: string, @CurrentUser() user: UserDocument) {
    return this.eventsService.leave(id, (user._id as any).toString());
  }

  @Get(':id/players')
  players(@Param('id') id: string) {
    return this.eventsService.listPlayers(id);
  }
}
```

- [ ] **Step 5: Write events module**

```typescript
// src/events/events.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { Event, EventSchema } from './schemas/event.schema';
import { EventPlayer, EventPlayerSchema } from './schemas/event-player.schema';
import { GroupMember, GroupMemberSchema } from '../groups/schemas/group-member.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: EventPlayer.name, schema: EventPlayerSchema },
      { name: GroupMember.name, schema: GroupMemberSchema },
    ]),
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService, MongooseModule],
})
export class EventsModule {}
```

- [ ] **Step 6: Add EventsModule to app.module.ts**

```typescript
// src/app.module.ts — add to imports:
import { EventsModule } from './events/events.module';
// ...
imports: [
  // ...existing...
  EventsModule,
],
```

- [ ] **Step 7: Commit events module**

```bash
git add src/events/ src/app.module.ts
git commit -m "feat: add events module — create, list, join, leave, list players"
```

---

## Task 14: Tournaments Module

**Files:**
- Create: `src/tournaments/dto/create-tournament.dto.ts`
- Create: `src/tournaments/dto/register-team.dto.ts`
- Create: `src/tournaments/dto/update-match.dto.ts`
- Create: `src/tournaments/tournaments.service.ts`
- Create: `src/tournaments/tournaments.controller.ts`
- Create: `src/tournaments/tournaments.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/tournaments/dto
```

- [ ] **Step 2: Write DTOs**

```typescript
// src/tournaments/dto/create-tournament.dto.ts
import { IsString, IsOptional, IsEnum, IsNumber, IsDateString, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTournamentDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsEnum(['knockout', 'league'])
  type: string;

  @Type(() => Number)
  @IsNumber()
  maxTeams: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
```

```typescript
// src/tournaments/dto/register-team.dto.ts
import { IsString, IsArray, IsOptional, MinLength } from 'class-validator';

export class RegisterTeamDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsArray()
  @IsString({ each: true })
  players: string[];

  @IsOptional()
  @IsString()
  captainId?: string;
}
```

```typescript
// src/tournaments/dto/update-match.dto.ts
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMatchDto {
  @Type(() => Number)
  @IsNumber()
  scoreA: number;

  @Type(() => Number)
  @IsNumber()
  scoreB: number;

  @IsOptional()
  @IsString()
  winnerId?: string;
}
```

- [ ] **Step 3: Write tournaments service**

```typescript
// src/tournaments/tournaments.service.ts
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tournament, TournamentDocument } from './schemas/tournament.schema';
import { TournamentTeam, TournamentTeamDocument } from './schemas/tournament-team.schema';
import { TournamentMatch, TournamentMatchDocument } from './schemas/tournament-match.schema';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTeamDto } from './dto/register-team.dto';
import { UpdateMatchDto } from './dto/update-match.dto';

@Injectable()
export class TournamentsService {
  constructor(
    @InjectModel(Tournament.name) private tournamentModel: Model<TournamentDocument>,
    @InjectModel(TournamentTeam.name) private teamModel: Model<TournamentTeamDocument>,
    @InjectModel(TournamentMatch.name) private matchModel: Model<TournamentMatchDocument>,
  ) {}

  async create(userId: string, dto: CreateTournamentDto): Promise<TournamentDocument> {
    return this.tournamentModel.create({
      ...dto,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : null,
      createdBy: new Types.ObjectId(userId),
    });
  }

  async findById(tournamentId: string) {
    const tournament = await this.tournamentModel.findById(tournamentId).lean();
    if (!tournament) throw new NotFoundException('Tournament not found');
    const teams = await this.teamModel.find({ tournamentId: new Types.ObjectId(tournamentId) }).lean();
    const matches = await this.matchModel.find({ tournamentId: new Types.ObjectId(tournamentId) }).lean();
    return { tournament, teams, matches };
  }

  async registerTeam(tournamentId: string, userId: string, dto: RegisterTeamDto) {
    const tournament = await this.tournamentModel.findById(tournamentId);
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.status !== 'registering') throw new BadRequestException('Tournament is not accepting registrations');
    if (tournament.currentTeams >= tournament.maxTeams) throw new BadRequestException('Tournament is full');

    const team = await this.teamModel.create({
      tournamentId: new Types.ObjectId(tournamentId),
      name: dto.name,
      players: dto.players.map((id) => new Types.ObjectId(id)),
      captainId: dto.captainId ? new Types.ObjectId(dto.captainId) : new Types.ObjectId(userId),
    });

    await this.tournamentModel.findByIdAndUpdate(tournamentId, { $inc: { currentTeams: 1 } });
    return team;
  }

  async updateMatch(tournamentId: string, matchId: string, userId: string, dto: UpdateMatchDto) {
    const tournament = await this.tournamentModel.findById(tournamentId);
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.createdBy.toString() !== userId) {
      throw new ForbiddenException('Only tournament creator can update match scores');
    }

    return this.matchModel.findByIdAndUpdate(
      matchId,
      {
        $set: {
          scoreA: dto.scoreA,
          scoreB: dto.scoreB,
          winnerId: dto.winnerId ? new Types.ObjectId(dto.winnerId) : null,
        },
      },
      { new: true },
    );
  }
}
```

- [ ] **Step 4: Write tournaments controller**

```typescript
// src/tournaments/tournaments.controller.ts
import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTeamDto } from './dto/register-team.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { UserDocument } from '../users/schemas/user.schema';

@Controller('tournaments')
@UseGuards(JwtAuthGuard)
export class TournamentsController {
  constructor(private tournamentsService: TournamentsService) {}

  @Post()
  create(@CurrentUser() user: UserDocument, @Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create((user._id as any).toString(), dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tournamentsService.findById(id);
  }

  @Post(':id/teams')
  registerTeam(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Body() dto: RegisterTeamDto,
  ) {
    return this.tournamentsService.registerTeam(id, (user._id as any).toString(), dto);
  }

  @Patch(':id/matches/:matchId')
  updateMatch(
    @Param('id') tournamentId: string,
    @Param('matchId') matchId: string,
    @CurrentUser() user: UserDocument,
    @Body() dto: UpdateMatchDto,
  ) {
    return this.tournamentsService.updateMatch(tournamentId, matchId, (user._id as any).toString(), dto);
  }
}
```

- [ ] **Step 5: Write tournaments module**

```typescript
// src/tournaments/tournaments.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { Tournament, TournamentSchema } from './schemas/tournament.schema';
import { TournamentTeam, TournamentTeamSchema } from './schemas/tournament-team.schema';
import { TournamentMatch, TournamentMatchSchema } from './schemas/tournament-match.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tournament.name, schema: TournamentSchema },
      { name: TournamentTeam.name, schema: TournamentTeamSchema },
      { name: TournamentMatch.name, schema: TournamentMatchSchema },
    ]),
  ],
  controllers: [TournamentsController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
```

- [ ] **Step 6: Add TournamentsModule to app.module.ts**

```typescript
// src/app.module.ts — add to imports:
import { TournamentsModule } from './tournaments/tournaments.module';
// ...
imports: [
  // ...existing...
  TournamentsModule,
],
```

- [ ] **Step 7: Commit tournaments module**

```bash
git add src/tournaments/ src/app.module.ts
git commit -m "feat: add tournaments module — create, register team, update match scores"
```

---

## Task 15: Shuffle Module (Fisher-Yates, 6-per-sub-group)

**Files:**
- Create: `src/shuffle/shuffle.service.ts`
- Create: `src/shuffle/shuffle.controller.ts`
- Create: `src/shuffle/shuffle.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/shuffle
```

- [ ] **Step 2: Write shuffle service**

```typescript
// src/shuffle/shuffle.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventPlayer, EventPlayerDocument } from '../events/schemas/event-player.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import { GroupMember, GroupMemberDocument } from '../groups/schemas/group-member.schema';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ShuffleService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name) private playerModel: Model<EventPlayerDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
    private notificationsService: NotificationsService,
  ) {}

  async shuffle(eventId: string, requesterId: string) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');

    if (event.groupId) {
      const member = await this.memberModel.findOne({
        groupId: event.groupId,
        userId: new Types.ObjectId(requesterId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      if (!member) throw new ForbiddenException('Only group owner or admin can shuffle players');
    } else if (event.createdBy.toString() !== requesterId) {
      throw new ForbiddenException('Only event creator can shuffle players');
    }

    const players = await this.playerModel
      .find({ eventId: new Types.ObjectId(eventId), status: 'joined' })
      .lean();

    const shuffled = fisherYates([...players]);
    const GROUP_SIZE = 6;

    const bulkOps = shuffled.map((player, index) => {
      const groupNumber = Math.floor(index / GROUP_SIZE) + 1;
      return {
        updateOne: {
          filter: { _id: player._id },
          update: { $set: { team: String(groupNumber) } },
        },
      };
    });

    await this.playerModel.bulkWrite(bulkOps);

    // Notify all players
    await Promise.all(
      shuffled.map((player) =>
        this.notificationsService.create({
          userId: player.userId.toString(),
          title: 'Teams shuffled!',
          body: `Players have been shuffled for the event. Check your team assignment.`,
          type: 'event',
          refId: eventId,
        }),
      ),
    );

    return { message: `${shuffled.length} players shuffled into groups of ${GROUP_SIZE}` };
  }
}

function fisherYates<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

- [ ] **Step 3: Write shuffle controller**

```typescript
// src/shuffle/shuffle.controller.ts
import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ShuffleService } from './shuffle.service';
import { UserDocument } from '../users/schemas/user.schema';

@Controller('events/:id/shuffle')
@UseGuards(JwtAuthGuard)
export class ShuffleController {
  constructor(private shuffleService: ShuffleService) {}

  @Post()
  shuffle(@Param('id') eventId: string, @CurrentUser() user: UserDocument) {
    return this.shuffleService.shuffle(eventId, (user._id as any).toString());
  }
}
```

- [ ] **Step 4: Write shuffle module**

```typescript
// src/shuffle/shuffle.module.ts
import { Module } from '@nestjs/common';
import { ShuffleController } from './shuffle.controller';
import { ShuffleService } from './shuffle.service';
import { EventsModule } from '../events/events.module';
import { GroupsModule } from '../groups/groups.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EventsModule, GroupsModule, NotificationsModule],
  controllers: [ShuffleController],
  providers: [ShuffleService],
})
export class ShuffleModule {}
```

- [ ] **Step 5: Add ShuffleModule to app.module.ts**

```typescript
// src/app.module.ts — add to imports:
import { ShuffleModule } from './shuffle/shuffle.module';
// ...
imports: [
  // ...existing...
  ShuffleModule,
],
```

- [ ] **Step 6: Commit shuffle module**

```bash
git add src/shuffle/ src/app.module.ts
git commit -m "feat: add shuffle module — Fisher-Yates shuffle into groups of 6"
```

---

## Task 16: Final app.module.ts and Server Boot Check

- [ ] **Step 1: Write final app.module.ts with all modules**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GroupsModule } from './groups/groups.module';
import { InvitationsModule } from './invitations/invitations.module';
import { ChatModule } from './chat/chat.module';
import { EventsModule } from './events/events.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { ShuffleModule } from './shuffle/shuffle.module';
import { NotificationsModule } from './notifications/notifications.module';

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
    GroupsModule,
    InvitationsModule,
    ChatModule,
    EventsModule,
    TournamentsModule,
    ShuffleModule,
    NotificationsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Start server and confirm clean boot**

```bash
npm run start:dev
```

Expected: `KicKR API running on port 3000` with no TypeScript errors and no unresolved imports.

- [ ] **Step 3: Commit final app module**

```bash
git add src/app.module.ts
git commit -m "chore: wire all modules into app.module.ts"
```

---

## Task 17: E2E Tests for Groups, Events, Tournaments

**Files:**
- Create: `test/groups.e2e-spec.ts`
- Create: `test/events.e2e-spec.ts`
- Create: `test/tournaments.e2e-spec.ts`

- [ ] **Step 1: Write groups e2e tests**

```typescript
// test/groups.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Group } from '../src/groups/schemas/group.schema';
import { GroupMember } from '../src/groups/schemas/group-member.schema';
import { Model } from 'mongoose';

describe('Groups (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;
  let groupModel: Model<any>;
  let memberModel: Model<any>;
  let token: string;
  let groupId: string;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));
    groupModel = app.get(getModelToken(Group.name));
    memberModel = app.get(getModelToken(GroupMember.name));

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Group Owner', email: 'owner@test-e2e.com', password: 'password123' });
    await userModel.updateOne({ email: 'owner@test-e2e.com' }, { $set: { emailVerified: true } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@test-e2e.com', password: 'password123' });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await groupModel.deleteMany({ name: /E2E/ });
    await app.close();
  });

  it('POST /groups — creates group', async () => {
    const res = await request(app.getHttpServer())
      .post('/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'E2E Group', description: 'Test group' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('name', 'E2E Group');
    groupId = res.body.data._id;
  });

  it('GET /groups/:id — returns group', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('_id', groupId);
  });

  it('PATCH /groups/:id — updates group name', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'E2E Group Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('name', 'E2E Group Updated');
  });

  it('GET /groups/:id/members — lists members', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /groups/:id/invite-code — generates code', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/invite-code`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('inviteCode');
  });
});
```

- [ ] **Step 2: Write events e2e tests**

```typescript
// test/events.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Event } from '../src/events/schemas/event.schema';
import { EventPlayer } from '../src/events/schemas/event-player.schema';
import { Model } from 'mongoose';

describe('Events (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;
  let eventModel: Model<any>;
  let playerModel: Model<any>;
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));
    eventModel = app.get(getModelToken(Event.name));
    playerModel = app.get(getModelToken(EventPlayer.name));

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Event Creator', email: 'eventcreator@test-e2e.com', password: 'password123' });
    await userModel.updateOne({ email: 'eventcreator@test-e2e.com' }, { $set: { emailVerified: true } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'eventcreator@test-e2e.com', password: 'password123' });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await eventModel.deleteMany({ title: /E2E/ });
    await playerModel.deleteMany({});
    await app.close();
  });

  it('POST /events — creates event', async () => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'E2E Match',
        date: new Date(Date.now() + 86400000).toISOString(),
        isPublic: true,
        maxPlayers: 12,
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('title', 'E2E Match');
    eventId = res.body.data._id;
  });

  it('GET /events — lists events', async () => {
    const res = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /events/:id/join — joins event', async () => {
    const res = await request(app.getHttpServer())
      .post(`/events/${eventId}/join`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
  });

  it('POST /events/:id/join — rejects duplicate join', async () => {
    const res = await request(app.getHttpServer())
      .post(`/events/${eventId}/join`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  it('GET /events/:id/players — lists joined players', async () => {
    const res = await request(app.getHttpServer())
      .get(`/events/${eventId}/players`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('DELETE /events/:id/join — leaves event', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/events/${eventId}/join`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Write tournaments e2e tests**

```typescript
// test/tournaments.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Tournament } from '../src/tournaments/schemas/tournament.schema';
import { TournamentTeam } from '../src/tournaments/schemas/tournament-team.schema';
import { Model } from 'mongoose';

describe('Tournaments (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;
  let tournamentModel: Model<any>;
  let teamModel: Model<any>;
  let token: string;
  let userId: string;
  let tournamentId: string;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));
    tournamentModel = app.get(getModelToken(Tournament.name));
    teamModel = app.get(getModelToken(TournamentTeam.name));

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Tournament Creator', email: 'tournament@test-e2e.com', password: 'password123' });
    await userModel.updateOne({ email: 'tournament@test-e2e.com' }, { $set: { emailVerified: true } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'tournament@test-e2e.com', password: 'password123' });
    token = login.body.data.token;
    userId = login.body.data.user._id;
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await tournamentModel.deleteMany({ title: /E2E/ });
    await teamModel.deleteMany({});
    await app.close();
  });

  it('POST /tournaments — creates tournament', async () => {
    const res = await request(app.getHttpServer())
      .post('/tournaments')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'E2E Cup', type: 'knockout', maxTeams: 8 });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('title', 'E2E Cup');
    tournamentId = res.body.data._id;
  });

  it('GET /tournaments/:id — returns tournament with teams and matches', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tournaments/${tournamentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('tournament');
    expect(res.body.data).toHaveProperty('teams');
    expect(res.body.data).toHaveProperty('matches');
  });

  it('POST /tournaments/:id/teams — registers team', async () => {
    const res = await request(app.getHttpServer())
      .post(`/tournaments/${tournamentId}/teams`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'E2E FC', players: [userId] });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('name', 'E2E FC');
  });
});
```

- [ ] **Step 4: Run all e2e tests**

```bash
MONGODB_URI=mongodb://localhost:27017/kickr_test npm run test:e2e
```

Expected: all tests pass across auth, users, groups, events, tournaments suites.

- [ ] **Step 5: Commit e2e tests**

```bash
git add test/
git commit -m "test: add e2e tests for groups, events, and tournaments"
```

---

## Spec Coverage Check

- [x] Create Group → `POST /groups` (Task 10)
- [x] Update group name/wallpaper → `PATCH /groups/:id` + `POST /groups/:id/wallpaper` (Task 10)
- [x] Group Invitation (name search + approval) → `POST/GET/PATCH /groups/:id/invitations` (Task 11)
- [x] Group Invitation (QR) → `GET /groups/:id/invite-code` + `POST /groups/join-by-code` (Tasks 10, 11)
- [x] Group Chat real-time → Socket.io gateway `/chat` (Task 12)
- [x] Group Chat history → `GET /groups/:id/messages` (Task 12)
- [x] Create Event (owner/admin only if group-scoped) → `POST /events` (Task 13)
- [x] Join/Leave Event → `POST/DELETE /events/:id/join` (Task 13)
- [x] Create Tournament → `POST /tournaments` (Task 14)
- [x] Register team + update match score → Tasks 14
- [x] Shuffle players (6 per group) → `POST /events/:id/shuffle` (Task 15)
- [x] Notifications stored on shuffle → Task 15
- [x] Notifications CRUD → `GET/PATCH /notifications` (Task 9)
- [x] All modules wired → Task 16
- [x] E2E test coverage → Task 17
