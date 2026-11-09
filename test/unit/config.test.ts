import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SERVER_PEPPER: 'a'.repeat(64), // hex, 32 bytes
  JWT_SECRET: Buffer.alloc(32, 7).toString('base64'),
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      jwtTtlDays: 30,
      trustProxy: false,
      rateLimitMax: 120,
      docsEnabled: true,
      rulepackPublicKey: undefined,
    });
    expect(c.appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('decodes hex and base64 secrets', () => {
    const c = loadConfig(base);
    expect(c.serverPepper).toHaveLength(32);
    expect(c.jwtSecret).toHaveLength(32);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(loadConfig(base))).toBe(true);
  });

  it('fails fast with a readable message listing every problem', () => {
    expect.assertions(4);
    try {
      loadConfig({ SERVER_PEPPER: 'short', PORT: 'abc' });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('SERVER_PEPPER');
      expect(message).toContain('PORT');
    }
  });

  it('rejects secrets shorter than 32 bytes', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: Buffer.alloc(31).toString('base64') })).toThrow(
      /JWT_SECRET/,
    );
  });

  it.each([
    ['false', false],
    ['true', true],
    ['1', 1],
    ['10.0.0.0/8, 192.168.0.0/16', ['10.0.0.0/8', '192.168.0.0/16']],
  ])('parses TRUST_PROXY=%s', (value, expected) => {
    expect(loadConfig({ ...base, TRUST_PROXY: value }).trustProxy).toEqual(expected);
  });

  it('parses booleans and numbers', () => {
    const c = loadConfig({ ...base, DOCS_ENABLED: 'false', PORT: '8080', RATE_LIMIT_MAX: '5' });
    expect(c).toMatchObject({ docsEnabled: false, port: 8080, rateLimitMax: 5 });
    expect(() => loadConfig({ ...base, DOCS_ENABLED: 'yes' })).toThrow(/DOCS_ENABLED/);
  });

  it('validates the rule-pack public key length', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    expect(loadConfig({ ...base, RULEPACK_PUBLIC_KEY: key }).rulepackPublicKey).toHaveLength(32);
    expect(() => loadConfig({ ...base, RULEPACK_PUBLIC_KEY: 'AAAA' })).toThrow(
      /RULEPACK_PUBLIC_KEY/,
    );
  });

  it('treats empty strings as unset', () => {
    const c = loadConfig({ ...base, APP_VERSION: '', RULEPACK_PUBLIC_KEY: '', PORT: '' });
    expect(c.port).toBe(3000);
    expect(c.rulepackPublicKey).toBeUndefined();
  });

  it('honours APP_VERSION', () => {
    expect(loadConfig({ ...base, APP_VERSION: '9.9.9' }).appVersion).toBe('9.9.9');
  });
});
