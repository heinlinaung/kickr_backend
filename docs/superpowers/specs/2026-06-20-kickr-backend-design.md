# KicKR Backend — Phase 1 Design Spec

**Date:** 2026-06-20  
**Scope:** First Phase (10 features)  
**Stack:** NestJS · MongoDB (Mongoose) · Socket.io · JWT · Nodemailer  

---

## 1. Overview

KicKR is a football event and tournament management platform. The backend exposes a REST API (+ WebSocket for chat) consumed by the Flutter mobile app. Phase 1 delivers the following features:

1. Sign In
2. Sign Up → Email confirmation
3. Forgot Password
4. Edit Profile
5. Create Group (update name, wallpaper)
6. Group Invitation (QR or name, approval by admin/owner)
7. Group Chat (real-time)
8. Create Event (by group owner or admin)
9. Create Tournament
10. Shuffle Players (6 people per sub-group)

---

## 2. Architecture

### 2.1 Project Structure

```
kickr-backend/
├── src/
│   ├── main.ts                    # Bootstrap, global pipes, CORS
│   ├── app.module.ts              # Root module
│   ├── auth/                      # Features 1–3
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts
│   │   │   ├── google.strategy.ts  # stub
│   │   │   └── facebook.strategy.ts # stub
│   │   └── dto/
│   │       ├── login.dto.ts
│   │       ├── signup.dto.ts
│   │       └── forgot-password.dto.ts
│   ├── users/                     # Feature 4
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── schemas/user.schema.ts
│   │   └── dto/update-profile.dto.ts
│   ├── groups/                    # Features 5–6
│   │   ├── groups.module.ts
│   │   ├── groups.controller.ts
│   │   ├── groups.service.ts
│   │   ├── schemas/group.schema.ts
│   │   └── dto/
│   │       ├── create-group.dto.ts
│   │       └── update-group.dto.ts
│   ├── invitations/               # Feature 6 (invitation flow)
│   │   ├── invitations.module.ts
│   │   ├── invitations.controller.ts
│   │   ├── invitations.service.ts
│   │   └── dto/respond-invitation.dto.ts
│   ├── chat/                      # Feature 7
│   │   ├── chat.module.ts
│   │   ├── chat.gateway.ts        # Socket.io WebSocket gateway
│   │   ├── chat.service.ts
│   │   └── schemas/message.schema.ts
│   ├── events/                    # Feature 8
│   │   ├── events.module.ts
│   │   ├── events.controller.ts
│   │   ├── events.service.ts
│   │   ├── schemas/event.schema.ts
│   │   └── dto/create-event.dto.ts
│   ├── tournaments/               # Feature 9
│   │   ├── tournaments.module.ts
│   │   ├── tournaments.controller.ts
│   │   ├── tournaments.service.ts
│   │   ├── schemas/tournament.schema.ts
│   │   └── dto/create-tournament.dto.ts
│   ├── shuffle/                   # Feature 10
│   │   ├── shuffle.module.ts
│   │   ├── shuffle.controller.ts
│   │   └── shuffle.service.ts
│   ├── notifications/             # Cross-cutting
│   │   ├── notifications.module.ts
│   │   ├── notifications.service.ts
│   │   └── schemas/notification.schema.ts
│   └── common/
│       ├── guards/
│       │   └── jwt-auth.guard.ts
│       ├── decorators/
│       │   └── current-user.decorator.ts
│       ├── interceptors/
│       │   └── transform.interceptor.ts  # Consistent response shape
│       └── upload/
│           └── multer.config.ts          # Local disk storage
├── .env.example
├── package.json
└── tsconfig.json
```

### 2.2 Tech Stack Versions (target)

| Package | Purpose |
|---|---|
| `@nestjs/core` ^10 | Framework |
| `@nestjs/mongoose` | Mongoose ODM integration |
| `mongoose` ^8 | MongoDB schemas & queries |
| `@nestjs/jwt` + `@nestjs/passport` | JWT authentication |
| `passport-jwt` | JWT strategy |
| `passport-google-oauth20` | Google OAuth (stub) |
| `passport-facebook` | Facebook OAuth (stub) |
| `bcrypt` | Password hashing |
| `nodemailer` | Email (confirmation, password reset) |
| `@nestjs/websockets` + `socket.io` | Real-time group chat |
| `multer` | Local disk file uploads |
| `class-validator` + `class-transformer` | DTO validation |
| `@nestjs/config` | Env var management |

---

## 3. Data Models (MongoDB / Mongoose)

### 3.1 User

```
users/{userId}
{
  _id: ObjectId,
  name: string,
  username: string (unique),
  displayName: string,
  email: string (unique),
  passwordHash: string,
  phoneNumber: string,
  height: number,
  weight: number,
  profileImage: string,       // relative path: /uploads/profiles/<filename>
  role: "player" | "owner",
  joinedGroups: [ObjectId],   // ref: Group
  emailVerified: boolean,
  emailVerificationToken: string,
  passwordResetToken: string,
  passwordResetExpiry: Date,
  createdAt: Date
}
```

### 3.2 Notification

```
users/{userId}/notifications/{notificationId}
→ Stored as top-level collection for query efficiency:

notifications/{notificationId}
{
  _id: ObjectId,
  userId: ObjectId,           // recipient
  title: string,
  body: string,
  type: "event" | "group",
  refId: string,              // eventId or groupId
  isRead: boolean,
  createdAt: Date
}
```

### 3.3 Group

```
groups/{groupId}
{
  _id: ObjectId,
  name: string,
  description: string,
  ownerId: ObjectId,          // ref: User
  wallpaper: string,          // relative path: /uploads/groups/<filename>
  locationName: string,
  latitude: number,
  longitude: number,
  isPrivate: boolean,
  maxPlayers: number,
  createdAt: Date
}
```

### 3.4 GroupMember

```
group_members/{id}
{
  _id: ObjectId,
  groupId: ObjectId,
  userId: ObjectId,
  role: "owner" | "admin" | "member",
  status: "pending" | "approved",
  joinedAt: Date
}
```

### 3.5 Message

```
messages/{messageId}
{
  _id: ObjectId,
  groupId: ObjectId,
  senderId: ObjectId,
  text: string,
  createdAt: Date
}
```

### 3.6 Event

```
events/{eventId}
{
  _id: ObjectId,
  title: string,
  description: string,
  date: Date,
  groupId: ObjectId | null,   // null if public standalone
  isPublic: boolean,
  createdBy: ObjectId,
  locationName: string,
  latitude: number,
  longitude: number,
  maxPlayers: number,
  joinedCount: number,
  sportType: "football" | "futsal",
  skillLevel: "beginner" | "intermediate" | "advanced",
  price: number,
  status: "open" | "full" | "done",
  createdAt: Date
}
```

### 3.7 EventPlayer

```
event_players/{id}
{
  _id: ObjectId,
  eventId: ObjectId,
  userId: ObjectId,
  joinedAt: Date,
  team: "A" | "B" | null,
  position: string,
  status: "joined" | "cancelled",
  checkInTime: Date
}
```

### 3.8 Tournament

```
tournaments/{tournamentId}
{
  _id: ObjectId,
  title: string,
  createdBy: ObjectId,
  groupId: ObjectId | null,
  type: "knockout" | "league",
  maxTeams: number,
  currentTeams: number,
  status: "registering" | "ongoing" | "finished",
  startDate: Date,
  createdAt: Date
}
```

### 3.9 TournamentTeam

```
tournament_teams/{id}
{
  _id: ObjectId,
  tournamentId: ObjectId,
  name: string,
  players: [ObjectId],
  captainId: ObjectId,
  createdAt: Date
}
```

### 3.10 TournamentMatch

```
tournament_matches/{id}
{
  _id: ObjectId,
  tournamentId: ObjectId,
  round: number,
  matchNumber: number,
  teamAId: ObjectId,
  teamBId: ObjectId,
  scoreA: number,
  scoreB: number,
  winnerId: ObjectId | null,
  nextMatchId: ObjectId | null,
  scheduledAt: Date
}
```

---

## 4. API Endpoints

All authenticated routes require `Authorization: Bearer <jwt>` header.  
All responses follow the shape: `{ success: boolean, data: any, message?: string }`.

### 4.1 Auth (`/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | — | Register, send confirmation email |
| POST | `/auth/login` | — | Email + password → JWT |
| POST | `/auth/confirm-email` | — | Verify token from email link |
| POST | `/auth/forgot-password` | — | Send reset link via nodemailer |
| POST | `/auth/reset-password` | — | Submit new password with reset token |
| GET | `/auth/google` | — | Stub (returns 501) |
| GET | `/auth/facebook` | — | Stub (returns 501) |

### 4.2 Users (`/users`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | ✓ | Get current user profile |
| PATCH | `/users/me` | ✓ | Update profile fields |
| POST | `/users/me/avatar` | ✓ | Upload profile image (multipart) |

### 4.3 Groups (`/groups`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/groups` | ✓ | Create group |
| GET | `/groups/:id` | ✓ | Get group details |
| PATCH | `/groups/:id` | ✓ owner/admin | Update name, description |
| POST | `/groups/:id/wallpaper` | ✓ owner/admin | Upload wallpaper (multipart) |
| GET | `/groups/:id/members` | ✓ | List members |
| DELETE | `/groups/:id/members/:userId` | ✓ owner/admin | Remove member |

### 4.4 Invitations (`/groups/:id/invitations`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/groups/:id/invitations` | ✓ | Request to join (by name search) |
| GET | `/groups/:id/invitations` | ✓ owner/admin | List pending invitations |
| PATCH | `/groups/:id/invitations/:invId` | ✓ owner/admin | Approve or reject |
| GET | `/groups/:id/invite-code` | ✓ owner/admin | Get QR invite token |
| POST | `/groups/join-by-code` | ✓ | Join via QR code token |

### 4.5 Chat (`/groups/:id/messages` + WebSocket)

**REST** (history fetch):

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/groups/:id/messages` | ✓ member | Paginated message history |

**WebSocket** (Socket.io):

- Connect: `ws://<host>?token=<jwt>`
- Events emitted by client:
  - `joinRoom` `{ groupId }` — join socket room
  - `sendMessage` `{ groupId, text }` — send message
- Events broadcast by server:
  - `newMessage` `{ messageId, senderId, text, createdAt }` — to all room members

### 4.6 Events (`/events`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/events` | ✓ | List public/group events |
| POST | `/events` | ✓ owner/admin | Create event |
| GET | `/events/:id` | ✓ | Get event details |
| POST | `/events/:id/join` | ✓ | Join event |
| DELETE | `/events/:id/join` | ✓ | Cancel join |
| GET | `/events/:id/players` | ✓ | List joined players |

### 4.7 Tournaments (`/tournaments`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/tournaments` | ✓ | Create tournament |
| GET | `/tournaments/:id` | ✓ | Get tournament + bracket |
| POST | `/tournaments/:id/teams` | ✓ | Register a team |
| PATCH | `/tournaments/:id/matches/:matchId` | ✓ owner | Update match score/winner |

### 4.8 Shuffle (`/events/:id/shuffle`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/events/:id/shuffle` | ✓ owner/admin | Shuffle joined players into groups of 6 |

**Shuffle logic:**  
Fisher-Yates shuffle on the list of `joined` EventPlayers → partition into groups of 6 → assign `team` field sequentially ("1", "2", "3" … or null for remainder — numeric strings to distinguish from tournament bracket teams). Result is written back to `event_players` collection and broadcast as a notification to all joined players.

### 4.9 Notifications (`/notifications`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | ✓ | List user notifications (unread first) |
| PATCH | `/notifications/:id/read` | ✓ | Mark as read |
| PATCH | `/notifications/read-all` | ✓ | Mark all as read |

---

## 5. Authentication & Security

- **JWT**: Access token (15m expiry). No refresh token in phase 1 — Flutter re-prompts login.
- **Password hashing**: bcrypt, saltRounds = 10.
- **Email confirmation**: Random UUID token stored on user; nodemailer sends link `GET /auth/confirm-email?token=<uuid>`.
- **Password reset**: Random UUID token + 1h expiry; nodemailer sends link with token; `POST /auth/reset-password` accepts `{ token, newPassword }`.
- **Role guard**: Custom `RolesGuard` checks GroupMember.role for group-scoped routes.
- **Social auth stubs**: Google and Facebook routes return HTTP 501 with `{ message: "Not implemented in phase 1" }`.

---

## 6. File Uploads

- **Library**: `multer` with `diskStorage`.
- **Destination**: `./uploads/profiles/` and `./uploads/groups/`.
- **Filename**: `<userId>-<timestamp>.<ext>` to avoid collisions.
- **Served**: Static files served at `/uploads/*` via `ServeStaticModule`.
- **Max size**: 5MB per file. Allowed MIME: `image/jpeg`, `image/png`, `image/webp`.
- **Swap path**: Replace `diskStorage` with S3 `multer-s3` in a later phase without changing controllers.

---

## 7. Real-time Chat

- **Gateway**: `ChatGateway` annotated with `@WebSocketGateway({ cors: true, namespace: '/chat' })`.
- **Auth**: `handleConnection` reads JWT from handshake query param, verifies with JwtService, attaches `userId` to socket.
- **Room**: Each group maps to a Socket.io room keyed by `groupId`.
- **Persistence**: Every `sendMessage` event writes to MongoDB `messages` collection, then broadcasts `newMessage` to the room.
- **History**: Flutter fetches the last 50 messages on `joinRoom` via REST, then listens for live `newMessage` events.

---

## 8. Error Handling

- Global `HttpExceptionFilter` returns `{ success: false, message: string, statusCode: number }`.
- `ValidationPipe` (global) returns 400 with field-level errors from `class-validator`.
- Mongoose `CastError` and `ValidationError` are caught and returned as 400.
- Duplicate key errors (e.g. duplicate email) caught and returned as 409.

---

## 9. Environment Variables

```env
# App
PORT=3000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/kickr

# JWT
JWT_SECRET=change_me
JWT_EXPIRES_IN=15m

# Nodemailer
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM="KicKR <noreply@kickr.app>"

# App base URL (used in email links)
APP_BASE_URL=http://localhost:3000

# Uploads
UPLOADS_DIR=./uploads
```

---

## 10. Out of Scope for Phase 1

- Player rating system
- Match replays / training video uploads
- Participation fee collection / group fund management
- Public event discovery feed (beyond basic list)
- Push notifications (FCM) — notifications stored in DB only
- Refresh tokens
- Admin dashboard
