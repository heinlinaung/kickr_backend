# Change Log — 2026-09-06 · HTTP request logging

**Branch:** `events-feature-spec`
**Tests:** 968 passing across 47 suites · build clean
**Verified:** unit, **plus real HTTP traffic through the actual middleware** —
see §5.

Morgan-style access logging on every route.

```
LOG   [HTTP] GET /events?region=yangon&limit=20 200 1.8ms 11b - 203.0.113.4
LOG   [HTTP] GET /events?token=[redacted]&region=yangon 200 0.5ms 11b - 203.0.113.4
WARN  [HTTP] GET /nope 404 0.9ms 143b - 203.0.113.4
ERROR [HTTP] GET /boom 500 0.3ms 7b - 203.0.113.4
LOG   [HTTP] GET /me 200 0.4ms 11b - 203.0.113.4 [68a1c2d3e4f5a6b7c8d9e0f1]
```

---

## 1. Not the `morgan` package

The ask named morgan, and this is deliberately morgan-*style* rather than
morgan itself.

- **No new dependency.** The sandbox cannot install packages, so adding one
  would mean blocking on the owner for something Nest's built-in `Logger`
  already does.
- **It inherits the app's log transport.** Morgan writes to its own stream;
  this goes through the same `Logger` every service already uses, so a future
  transport change applies to it automatically.
- **The decisive reason: redaction.** A default morgan format string writes the
  full URL, query string included. This app takes `?token=` on the socket
  handshake, and the log is the one artifact most likely to be shipped,
  indexed, and read by more people than the database. See §3.

## 2. One line, written on `finish`

The line is emitted from the response's `finish` event, not on the way in, so a
single record carries method, path, status, duration, size and caller. Two
half-lines per request would be worse to read and worse to grep.

`originalUrl` is captured **up front**: Express rewrites `url` during routing,
so reading it in the finish handler can yield the post-route value rather than
what the client actually asked for.

Severity follows the status — 5xx at `error`, 4xx at `warn`, else `log` — so a
500 surfaces in an error-level search without the reader needing to know that
5xx means trouble.

## 3. What is deliberately NOT logged

- **Sensitive query values are masked**: `token`, `access_token`,
  `refresh_token`, `password`, `code`, `cursor`, `fcmToken`, `apiKey`,
  `secret`, matched case-insensitively. `?TOKEN=` must not slip past a
  lowercase-only list, and a test covers that.
- **Headers are never read.** `Authorization: Bearer …` is where a token
  usually arrives, and a test asserts neither the value nor the word "bearer"
  reaches the log.
- **The user's email.** `request.user` is the full user document; logging it
  wholesale would turn the access log into a directory of user addresses. Only
  `_id` is written — which is what "who did this" actually needs.
- **Request and response bodies.** Never touched. A password change or a login
  would otherwise put credentials straight into the log.

Path segments are *not* redacted: they are ids, already present in responses,
and not credentials. Redacting them would make the log useless for debugging.

## 4. `x-forwarded-for`, and its limits

The IP is read from `x-forwarded-for` first, because nginx fronts the app on
the droplet — `req.ip` would otherwise be the proxy's loopback address on every
single request, making the field worthless.

Only the **first** entry is taken: the header is a client-appendable list, so a
caller can prepend arbitrary values. Treat the logged IP as a hint, not
evidence. Making it trustworthy needs `trust proxy` configured against the
known proxy, which is the same prerequisite noted when rate limiting was turned
off.

## 5. Verified against real traffic

The unit tests mock `Logger`, which proves the calls but not the output. So the
middleware was additionally mounted in a real Express app and driven with real
requests. The five lines at the top of this file are that run's actual output,
confirming end to end:

- non-sensitive params stay readable, `token` is masked
- 404 → WARN, 500 → ERROR, 200 → LOG
- the user id appears and the email — present on `req.user` in that test — does
  not

**Redaction verified by reverting:** disabling `safeUrl` fails **10 of the 22**
tests. Restored, all pass.

## 6. Not done

- **No request id.** Correlating several lines from one request, or tying a log
  line to a client error report, would want one. Worth adding with a
  `x-request-id` header if log volume ever makes it necessary.
- **No slow-request threshold.** Duration is recorded but nothing highlights a
  slow call; a `>1000ms` warn would be a small addition.
- **No sampling or rate limiting of the log itself.** Every request writes a
  line. On a 1 GB droplet with journald, worth watching if traffic grows.
- **Not load-tested.** The overhead is one `hrtime` pair and a string build per
  request, which is negligible in principle, but that has not been measured.
