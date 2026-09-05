// src/common/middleware/request-logger.middleware.spec.ts
import { Logger } from '@nestjs/common';
import { RequestLoggerMiddleware } from './request-logger.middleware';

describe('RequestLoggerMiddleware', () => {
  let middleware: RequestLoggerMiddleware;
  let logged: { level: string; message: string }[];
  let finish: () => void;

  const request = (over: Record<string, unknown> = {}) =>
    ({
      method: 'GET',
      originalUrl: '/events',
      ip: '203.0.113.4',
      headers: {},
      ...over,
    }) as any;

  const response = (over: Record<string, unknown> = {}) =>
    ({
      statusCode: 200,
      getHeader: () => undefined,
      on: (event: string, cb: () => void) => {
        if (event === 'finish') finish = cb;
      },
      ...over,
    }) as any;

  /** Runs a request through and returns the single line it logged. */
  const run = (req: any, res: any) => {
    const next = jest.fn();
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    finish();
    return logged[0];
  };

  beforeEach(() => {
    logged = [];
    middleware = new RequestLoggerMiddleware();
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: any) =>
          logged.push({ level, message: String(message) }),
        );
    }
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs method, path, status and duration on one line', () => {
    // One line per request, written on `finish` so it can carry the status.
    // Two half-lines would be worse to read and worse to grep.
    const entry = run(request(), response());

    expect(entry.message).toMatch(/^GET \/events 200 \d+\.\d+ms/);
  });

  it('calls next() so the request is not swallowed', () => {
    const next = jest.fn();
    middleware.use(request(), response(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  describe('redaction — the part that must not regress', () => {
    const urlFor = (query: string) =>
      run(request({ originalUrl: `/x?${query}` }), response()).message;

    it.each([
      'token',
      'access_token',
      'refresh_token',
      'password',
      'code',
      'fcmToken',
      'apiKey',
      'secret',
    ])('masks ?%s=', (param) => {
      const line = urlFor(`${param}=SUPERSECRETVALUE`);

      expect(line).not.toContain('SUPERSECRETVALUE');
      expect(line).toContain('[redacted]');
    });

    it('masks regardless of case', () => {
      // A client sending ?TOKEN= must not slip past a lowercase-only list.
      const line = urlFor('TOKEN=SUPERSECRETVALUE');

      expect(line).not.toContain('SUPERSECRETVALUE');
    });

    it('keeps non-sensitive params readable', () => {
      // Redacting everything would make the log useless for debugging.
      const line = urlFor('region=yangon&limit=20');

      expect(line).toContain('region=yangon');
      expect(line).toContain('limit=20');
    });

    it('masks only the sensitive param in a mixed query', () => {
      const line = urlFor('region=yangon&token=SUPERSECRETVALUE');

      expect(line).toContain('region=yangon');
      expect(line).not.toContain('SUPERSECRETVALUE');
    });

    it('leaves a query-less URL untouched', () => {
      const line = run(
        request({ originalUrl: '/events/68b0aa11bb22cc33dd44ee55' }),
        response(),
      ).message;

      expect(line).toContain('/events/68b0aa11bb22cc33dd44ee55');
    });

    it('does not log the Authorization header', () => {
      // The most common place a token actually arrives. Nothing reads headers,
      // and this pins that.
      const line = run(
        request({ headers: { authorization: 'Bearer SUPERSECRETVALUE' } }),
        response(),
      ).message;

      expect(line).not.toContain('SUPERSECRETVALUE');
      expect(line.toLowerCase()).not.toContain('bearer');
    });
  });

  describe('log level follows the status', () => {
    it('logs 2xx at log level', () => {
      expect(run(request(), response({ statusCode: 200 })).level).toBe('log');
    });

    it('logs 4xx at warn level', () => {
      expect(run(request(), response({ statusCode: 404 })).level).toBe('warn');
    });

    it('logs 5xx at error level', () => {
      // A 500 should surface in an error-level search without the reader
      // having to know that 5xx means trouble.
      expect(run(request(), response({ statusCode: 500 })).level).toBe('error');
    });
  });

  describe('caller identity', () => {
    it('includes the authenticated user id', () => {
      const line = run(
        request({ user: { _id: '68a1c2d3e4f5a6b7c8d9e0f1' } }),
        response(),
      ).message;

      expect(line).toContain('[68a1c2d3e4f5a6b7c8d9e0f1]');
    });

    it('never includes the user email', () => {
      // request.user is the full user document; logging it wholesale would
      // turn the access log into a directory of user email addresses.
      const line = run(
        request({
          user: { _id: '68a1c2d3', email: 'someone@example.com' },
        }),
        response(),
      ).message;

      expect(line).not.toContain('someone@example.com');
    });

    it('omits the marker for an anonymous request', () => {
      expect(run(request(), response()).message).not.toContain('[');
    });

    it('prefers x-forwarded-for, since nginx fronts the app', () => {
      // Without this every request would log the proxy's loopback address.
      const line = run(
        request({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } }),
        response(),
      ).message;

      expect(line).toContain('198.51.100.7');
      // The first entry only — the header is a client-appendable list.
      expect(line).not.toContain('10.0.0.1');
    });
  });
});
