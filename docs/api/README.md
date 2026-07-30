# KickR API docs (for the Flutter app)

Integration guides written against the **live** API — every request/response shown was captured from a real call, not from source reading.

| Doc | Covers |
|---|---|
| [auth-api.md](./auth-api.md) | Signup, login, **refresh**, forgot/reset password. Token storage and the 401→refresh→retry loop. |
| [groups-and-locations-api.md](./groups-and-locations-api.md) | Locations (creator-owned venues) and Groups (fields, images, rules, members/roles, search, QR invites). |

**Live reference while the server is running:** Swagger UI at `/api-docs`, OpenAPI JSON at `/api-docs-json`.

## Read this first

Two conventions apply to every endpoint in both docs:

1. **Success responses are wrapped in `data`**; error responses are **flat**, and `message` may be a **string or a list of strings**.
2. **Send the Cognito `accessToken`** as `Authorization: Bearer …` — the `idToken` is rejected with `401`.

Each doc ends with a **gotchas checklist** and a **"not built yet"** section, so the app isn't designed against unimplemented features.
