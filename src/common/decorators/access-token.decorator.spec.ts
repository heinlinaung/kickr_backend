// src/common/decorators/access-token.decorator.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { AccessToken, extractBearerToken } from './access-token.decorator';

describe('extractBearerToken', () => {
  const req = (headers: Record<string, unknown>) => ({ headers });

  it('returns the raw token', () => {
    expect(extractBearerToken(req({ authorization: 'Bearer abc.def.ghi' }))).toBe(
      'abc.def.ghi',
    );
  });

  it('returns only the token, never the whole header', () => {
    // Returning `header` verbatim would hand AWS "Bearer abc" and fail
    // confusingly at the far end rather than here.
    expect(extractBearerToken(req({ authorization: 'Bearer abc' }))).toBe('abc');
  });

  it('accepts a lowercase scheme', () => {
    // RFC 7235: the auth scheme is case-insensitive, and real clients vary.
    expect(extractBearerToken(req({ authorization: 'bearer abc' }))).toBe('abc');
  });

  it('rejects a missing header', () => {
    expect(() => extractBearerToken(req({}))).toThrow(UnauthorizedException);
  });

  it('rejects a non-bearer scheme', () => {
    expect(() =>
      extractBearerToken(req({ authorization: 'Basic dXNlcjpwYXNz' })),
    ).toThrow(UnauthorizedException);
  });

  it.each(['Bearer', 'Bearer '])('rejects %p with no token', (header) => {
    expect(() => extractBearerToken(req({ authorization: header }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-string header (array from a duplicated header)', () => {
    // Node collapses repeated headers into an array; indexing it as a string
    // would otherwise yield undefined and be sent onward as a token.
    expect(() =>
      extractBearerToken(req({ authorization: ['Bearer a', 'Bearer b'] })),
    ).toThrow(UnauthorizedException);
  });

  it('survives a request with no headers at all', () => {
    expect(() => extractBearerToken({})).toThrow(UnauthorizedException);
    expect(() => extractBearerToken(undefined)).toThrow(UnauthorizedException);
  });

  it('exposes a decorator built on this function', () => {
    expect(typeof AccessToken).toBe('function');
  });
});
