// src/notifications/push.service.spec.ts
import { createPrivateKey, generateKeyPairSync } from 'crypto';
import { normalisePrivateKey } from './push.service';

/**
 * A service-account key reaches the process in different shapes depending on
 * how the environment was loaded. Getting this wrong disables push with
 * "Failed to parse private key" and nothing else — the app starts fine, so it
 * is easy to miss. It broke a real droplet deployment.
 */
describe('normalisePrivateKey', () => {
  // A real key, so the assertion is "OpenSSL accepts this", not a string match.
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();

  const parses = (raw: string) => {
    createPrivateKey(normalisePrivateKey(raw));
    return true;
  };

  it('accepts a PEM with real newlines (dotenv, or a shell)', () => {
    expect(parses(pem)).toBe(true);
  });

  it('accepts one line of literal backslash-n (secret managers)', () => {
    expect(parses(pem.replace(/\n/g, '\\n'))).toBe(true);
  });

  it('accepts a DOUBLE-QUOTED value with literal backslash-n', () => {
    // The docker `--env-file` case. Docker does not strip quotes or process
    // escapes, so a value quoted for dotenv's benefit arrives with literal
    // quote characters attached — and one leading `"` is enough to make the
    // PEM unparseable.
    expect(parses(`"${pem.replace(/\n/g, '\\n')}"`)).toBe(true);
  });

  it('accepts a SINGLE-QUOTED value with literal backslash-n', () => {
    expect(parses(`'${pem.replace(/\n/g, '\\n')}'`)).toBe(true);
  });

  it('accepts a quoted value that already has real newlines', () => {
    expect(parses(`"${pem}"`)).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parses(`  ${pem}\n`)).toBe(true);
  });

  it('strips only ONE layer of quotes, and only matching ones', () => {
    // A key does not contain quotes, so anything beyond one matching pair is
    // not ours to remove — silently eating characters from a credential would
    // be worse than failing loudly.
    expect(normalisePrivateKey('"abc"')).toBe('abc');
    expect(normalisePrivateKey('""abc""')).toBe('"abc"');
    expect(normalisePrivateKey('"abc')).toBe('"abc');
    expect(normalisePrivateKey(`"abc'`)).toBe(`"abc'`);
  });

  it('leaves a value with no quotes and no escapes untouched', () => {
    expect(normalisePrivateKey('plain')).toBe('plain');
  });
});
