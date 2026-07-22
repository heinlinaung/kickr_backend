# KicKR Backend

REST API + real-time WebSocket backend for the KicKR football event and tournament management platform.

Built with **NestJS**, **MongoDB** (Mongoose), **Socket.io**, and **AWS Cognito**.

---

## Features (Phase 1)

- **Auth** — AWS Cognito-backed: username sign-up with Cognito email verification, login, forgot/reset password, token refresh
- **User profiles** — Edit profile fields, avatar upload
- **Groups** — Create/update groups, wallpaper upload, member management
- **Group Invitations** — Join by name search or QR invite code, approval flow
- **Group Chat** — Real-time Socket.io messaging + REST history
- **Events** — Create, join, leave, list players (owner/admin gated for group events)
- **Tournaments** — Create knockout/league tournaments, register teams, update match scores
- **Player Shuffle** — Fisher-Yates shuffle into sub-groups of 6 with notifications
- **Notifications** — In-app notification store (read/unread)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS ^10 |
| Database | MongoDB via Mongoose ^8 |
| Auth | AWS Cognito (RS256 JWKS verification via passport-jwt) |
| Real-time | Socket.io (@nestjs/websockets) |
| File uploads | Multer (local disk) |
| Validation | class-validator + class-transformer |
| API Docs | Swagger (@nestjs/swagger) |

---

## Prerequisites

- Node.js 20+
- MongoDB 6+ running locally or a MongoDB Atlas URI
- An AWS Cognito user pool + app client, and IAM credentials with Cognito access

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```env
MONGODB_URI=mongodb://localhost:27017/kickr
APP_BASE_URL=http://localhost:3000

# AWS Cognito
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your_iam_access_key
AWS_SECRET_ACCESS_KEY=your_iam_secret_key
COGNITO_USER_POOL_ID=your_user_pool_id
COGNITO_CLIENT_ID=your_app_client_id
COGNITO_CLIENT_SECRET=your_app_client_secret
```

### 3. Run in development

```bash
npm run start:dev
```

| URL | Description |
|---|---|
| `http://localhost:3000` | REST API |
| `http://localhost:3000/api` | Swagger UI |
| `http://localhost:3000/uploads/*` | Static file uploads |
| `ws://localhost:3000/chat?token=<accessToken>` | WebSocket (group chat) |

---

## Docker

### Run with Docker Compose (API + MongoDB)

```bash
docker compose up --build
```

This starts:
- `kickr-backend` on port `3000`
- `mongodb` on port `27017`

### Build image only

```bash
docker build -t kickr-backend .
```

---

## Scripts

```bash
npm run start:dev      # watch mode
npm run start:prod     # production (build first)
npm run build          # compile TypeScript
npm run test           # unit tests
npm run test:e2e       # e2e tests (uses kickr_test DB)
npm run test:cov       # test coverage report
npm run lint           # ESLint
```

---

## API Documentation

Interactive Swagger UI: **`http://localhost:3000/api`**

All endpoints are documented with request/response schemas and Cognito bearer auth.

### Response shape

```json
{ "success": true,  "data": { ... } }
{ "success": false, "statusCode": 400, "message": "..." }
```

### Authentication

Authentication is handled by AWS Cognito. Login via `POST /auth/login` to receive Cognito tokens (access + id + refresh). Pass the **access token** on all protected routes:

```
Authorization: Bearer <accessToken>
```

Notes:
- The sign-in identifier is the **username** (not email).
- The Cognito app client uses a client secret, so requests include a computed `SECRET_HASH`.
- Login uses the `ADMIN_USER_PASSWORD_AUTH` flow, which must be enabled on the app client.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | — | Register in Cognito + send verification code |
| POST | `/auth/confirm-signup` | — | Confirm sign-up with the emailed code |
| POST | `/auth/resend-confirmation` | — | Resend the sign-up confirmation code |
| POST | `/auth/login` | — | Login → Cognito tokens (access + id + refresh) |
| POST | `/auth/forgot-password` | — | Send password reset code |
| POST | `/auth/reset-password` | — | Submit new password with reset code |
| POST | `/auth/refresh` | — | Exchange refresh token for new tokens |
| GET | `/users/me` | ✓ | Get own profile |
| PATCH | `/users/me` | ✓ | Update profile fields |
| POST | `/users/me/avatar` | ✓ | Upload profile image (multipart) |
| POST | `/groups` | ✓ | Create group |
| GET | `/groups/:id` | ✓ | Get group details |
| PATCH | `/groups/:id` | ✓ owner/admin | Update group name/description |
| POST | `/groups/:id/wallpaper` | ✓ owner/admin | Upload wallpaper (multipart) |
| GET | `/groups/:id/members` | ✓ | List approved members |
| DELETE | `/groups/:id/members/:userId` | ✓ owner/admin | Remove a member |
| GET | `/groups/:id/invite-code` | ✓ owner/admin | Generate QR invite token (24h) |
| POST | `/groups/:id/invitations` | ✓ | Request to join group |
| GET | `/groups/:id/invitations` | ✓ owner/admin | List pending join requests |
| PATCH | `/groups/:id/invitations/:invId` | ✓ owner/admin | Approve or reject request |
| POST | `/groups/join-by-code` | ✓ | Join group via QR invite code |
| GET | `/groups/:id/messages` | ✓ member | Paginated chat history |
| GET | `/events` | ✓ | List public events |
| POST | `/events` | ✓ | Create event |
| GET | `/events/:id` | ✓ | Get event details |
| POST | `/events/:id/join` | ✓ | Join event |
| DELETE | `/events/:id/join` | ✓ | Leave event |
| GET | `/events/:id/players` | ✓ | List joined players |
| POST | `/events/:id/shuffle` | ✓ owner/admin | Shuffle players into groups of 6 |
| POST | `/tournaments` | ✓ | Create tournament |
| GET | `/tournaments/:id` | ✓ | Get tournament + teams + bracket |
| POST | `/tournaments/:id/teams` | ✓ | Register a team |
| PATCH | `/tournaments/:id/matches/:matchId` | ✓ creator | Update match score/winner |
| GET | `/notifications` | ✓ | List notifications (unread first) |
| PATCH | `/notifications/:id/read` | ✓ | Mark one notification as read |
| PATCH | `/notifications/read-all` | ✓ | Mark all notifications as read |

### WebSocket — Group Chat

Connect: `ws://localhost:3000/chat?token=<accessToken>`

**Emit:**

| Event | Payload | Description |
|---|---|---|
| `joinRoom` | `{ groupId: string }` | Join a group's chat room |
| `sendMessage` | `{ groupId: string, text: string }` | Send a message |

**Listen:**

| Event | Payload | Description |
|---|---|---|
| `newMessage` | `{ messageId, senderId, text, createdAt }` | Broadcast to room members |

---

## Project Structure

```
src/
├── auth/           # Cognito-backed signup, confirm, login, forgot/reset password, refresh
├── users/          # Profile CRUD, avatar upload
├── groups/         # Group management, wallpaper, invite codes
├── invitations/    # Join requests, QR join, approval flow
├── chat/           # Socket.io gateway + message history
├── events/         # Event CRUD, join/leave, player list
├── tournaments/    # Tournament, teams, match bracket
├── shuffle/        # Fisher-Yates player shuffle (6 per sub-group)
├── notifications/  # In-app notification store
└── common/
    ├── filters/        # Global HTTP exception filter
    ├── interceptors/   # Response transform interceptor
    ├── guards/         # JWT auth guard
    ├── decorators/     # @CurrentUser decorator
    └── upload/         # Multer disk storage config
```

---

## License

MIT
