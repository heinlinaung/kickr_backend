# Project README

## Overview

This project manages users, groups, events, teams, matches, results, standings, and ratings.

The system supports three main event roles:

- Admin / Owner
- Member
- Referee

Users can participate in events, join teams, view matches and results, and provide ratings after an event is completed.

---

## Main Modules

- Users
- Profiles
- Groups
- Events
- Teams
- Matches
- Results
- Standings
- Ratings
- Followers

---

# Event Flow

Events follow these stages:

1. Joined
2. Preparation
3. Ready to Play
4. Playing
5. Result
6. Done

## Admin / Owner

### Joined

Admin / Owner can:

- View all members and admins
- Remove members
- Review and approve additional players
- Manage `+1` / `+2` players who do not have an account

### Preparation

Admin / Owner can:

- Create teams
- View teams
- Add players manually
- Shuffle players

### Ready to Play

- View 3–4 teams

### Playing

- View matches
- Receive a 15-minute-before-match notification/countdown
- Edit match results

### Result

- View all matches
- View match scores
- View team standings

### Done

- Manage ratings
- View ratings

---

# Member Flow

## Joined

- View all event members

## Preparation

- View organizer information
- View preparation information

## Ready to Play

- View own team

## Playing

- View Red vs White teams
- View match results

## Result

- View all matches and scores
- View team standings

## Done

- Give rating

---

# Referee Flow

## Joined

- View all event members

## Preparation

- View organizer information
- View preparation information

## Ready to Play

- View 3–4 teams

## Playing

- View matches
- Receive a 15-minute-before-match notification/countdown
- Edit match results

## Result

- View all matches and scores
- View team standings

## Done

- Give rating

---

# Additional Players (+1 / +2)

After joining an event, users can add one or two additional players who do not have an application account.

These players should be supported as guest players.

The system should:

- Allow a member to add `+1` or `+2` players
- Identify guest players separately from registered users
- Allow the Admin / Owner to review and approve guest players
- Include approved guest players when creating teams
- Include guest players in matches, results, and standings where applicable

---

# Groups

## Create Group

The Create Group API supports group information such as:

```json
{
  "country": "thailand",
  "city": "bangkok"
}
```

## Edit Group

The Edit Group API uses the same field conventions.

### Country and City

`country` and `city` values should be stored in lowercase.

Example:

```text
Thailand → thailand
Bangkok → bangkok
```

Country and city values should be validated against the appropriate enum/reference data.

---

# Users

## Sign Up

User registration supports:

- Country
- Location

Example:

```json
{
  "country": "thailand",
  "location": "bangkok"
}
```

The values should follow the same normalization and validation rules used throughout the application.

---

# Profile

The profile API should provide the following statistics:

| Field | Description |
|---|---|
| Group Count | Number of groups associated with the user |
| Joined Event Count | Number of events joined by the user |
| Points | User's accumulated points |
| Followers Count | Number of users following the user |

Example response:

```json
{
  "group_count": 0,
  "joined_event_count": 0,
  "points": 0,
  "followers_count": 0
}
```

---

# Follow User

The system should provide an API for following another user.

The API should handle:

- Sending a follow request where required
- Accepting/rejecting requests where applicable
- Creating the follower relationship
- Returning the user's follower count

The exact behavior should follow the application's privacy and event participation rules.

---

# Authentication & Authorization

The application uses role-based access control.

Supported event roles:

```text
ADMIN / OWNER
MEMBER
REFEREE
```

Each role has different permissions for:

- Members
- Teams
- Matches
- Match results
- Ratings
- Event management

APIs should validate the authenticated user's role before allowing protected operations.

---

# Match Management

Matches contain information about participating teams and their results.

During the Playing stage:

- Admin / Owner can view and edit match results
- Referee can view and edit match results
- Members can view matches and results

Before a match starts, the system should provide a 15-minute notification/countdown.

---

# Results & Standings

After matches are completed, users can view:

- All matches
- Match scores
- Team results
- Team standings

Standings should be calculated consistently based on the application's scoring rules.

---

# Ratings

After an event is completed:

### Admin / Owner

Can:

- View ratings
- Manage ratings

### Member

Can:

- Give ratings

### Referee

Can:

- Give ratings

---

# API Conventions

## Request Data

Use consistent naming and validation across all APIs.

Example:

```json
{
  "country": "thailand",
  "city": "bangkok"
}
```

## Response Data

API responses should use consistent:

- HTTP status codes
- Error structures
- Pagination
- Validation messages
- Resource naming

---

# Development

## Installation

Clone the repository and install the project dependencies.

```bash
git clone <repository-url>
cd <project-directory>
```

Install dependencies according to the project's package manager.

```bash
npm install
```

## Environment Variables

Create the required environment file:

```bash
.env
```

Configure the required application settings, database connection, authentication configuration, and other environment-specific variables.

Do not commit secrets or private credentials to the repository.

---

# Project Structure

The project should be organized around the main business domains:

```text
src/
├── users/
├── profiles/
├── groups/
├── events/
├── teams/
├── matches/
├── results/
├── standings/
├── ratings/
└── followers/
```

Each module should keep its related:

- Controllers
- Services
- Models/Entities
- DTOs
- Validation
- Routes
- Tests

together where possible.

---

# Documentation Guidelines

When adding a new feature:

1. Update the relevant API documentation.
2. Update the README if the feature changes the main user flow.
3. Document new roles and permissions.
4. Document new request/response fields.
5. Add validation rules.
6. Add or update tests.

---

# Status

This README describes the current planned event, group, user, and profile changes and should be updated as the implementation evolves.
