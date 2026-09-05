// src/common/middleware/request-logger.middleware.ts
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Morgan-style access logging, built on Nest's own `Logger`.
 *
 * Deliberately not the `morgan` package: this needs no dependency, inherits
 * whatever log transport the app is configured with, and — the part that
 * matters — lets the redaction below be applied. A default morgan format
 * string would happily write query strings and tokens into the log.
 *
 * Logs on the response's `finish` event rather than on the way in, so one line
 * carries the status and duration. Two half-lines per request would be worse
 * to read and worse to grep.
 *
 * ```
 * GET /events?region=yangon 200 15ms 1.2kb - 203.0.113.4 [68a1c2d3...]
 * ```
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  /**
   * Query parameters whose values are replaced with `[redacted]`.
   *
   * Access tokens legitimately arrive as `?token=` on the socket handshake, and
   * anything reaching a log is likely to be shipped, indexed, and read by more
   * people than the database is. An invite code is a bearer credential too —
   * whoever holds it can join the group.
   */
  private static readonly SENSITIVE_PARAMS = new Set([
    'token',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'password',
    'code',
    'cursor',
    'fcmtoken',
    'apikey',
    'api_key',
    'secret',
  ]);

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    // Captured up front: Express rewrites `url` during routing, so reading it
    // in the finish handler can yield the post-route value rather than what
    // the client actually asked for.
    const { method, originalUrl } = req;

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const { statusCode } = res;
      const length = res.getHeader('content-length');
      const size = length ? `${length}b` : '-';

      // The authenticated user, when the guard has attached one. Far more
      // useful than the IP for "who did this" — and it is only the id, never
      // the email, which would turn the log into a directory of user
      // addresses.
      const userId = (req as Request & { user?: { _id?: unknown } }).user?._id;
      const who = userId ? ` [${String(userId)}]` : '';

      const line = `${method} ${this.safeUrl(originalUrl)} ${statusCode} ${ms.toFixed(1)}ms ${size} - ${this.clientIp(req)}${who}`;

      // Severity by status: a 500 should surface in an error-level search
      // without the reader needing to know that HTTP 5xx means trouble.
      if (statusCode >= 500) {
        this.logger.error(line);
      } else if (statusCode >= 400) {
        this.logger.warn(line);
      } else {
        this.logger.log(line);
      }
    });

    next();
  }

  /**
   * The URL with sensitive query values masked.
   *
   * Path segments are left alone: they are ids, which are already in the
   * response and are not credentials. It is the query string that carries
   * tokens.
   */
  private safeUrl(url: string): string {
    const split = url.indexOf('?');
    if (split === -1) return url;

    const path = url.slice(0, split);
    const params = new URLSearchParams(url.slice(split + 1));
    let touched = false;

    for (const key of [...params.keys()]) {
      if (RequestLoggerMiddleware.SENSITIVE_PARAMS.has(key.toLowerCase())) {
        params.set(key, '[redacted]');
        touched = true;
      }
    }
    if (!touched) return url;

    // decodeURIComponent so the redacted marker reads as `[redacted]` rather
    // than `%5Bredacted%5D`; the values themselves are gone by this point.
    return `${path}?${decodeURIComponent(params.toString())}`;
  }

  /**
   * The caller's IP.
   *
   * Reads `x-forwarded-for` because the app sits behind nginx on the droplet —
   * `req.ip` would otherwise be the proxy's loopback address for every single
   * request, making the field useless.
   *
   * Takes the FIRST entry: that header is a client-appendable list, so a caller
   * can prepend arbitrary values. The first is the original client as recorded
   * by the nearest trusted proxy. Treat it as a hint, not as evidence.
   */
  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? '-';
  }
}
