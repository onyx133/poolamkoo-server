import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  loadConfig,
  loadDbConfig,
  loadRetentionDays,
  loadRulePackCliConfig,
} from '../../src/config.js';

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
      dbPoolMax: 10,
      installRetentionDays: 180,
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

  it('rejects secrets that are not canonical base64 or hex', () => {
    const good = Buffer.alloc(32, 7).toString('base64');
    expect(loadConfig({ ...base, JWT_SECRET: good }).jwtSecret).toHaveLength(32);
    for (const bad of [
      good.replace(/=+$/, ''), // padding stripped
      `${good}!!`, // junk characters
      good.slice(0, -2) + '*=', // non-alphabet character
      Buffer.alloc(32, 7).toString('base64url') + '-', // url-safe alphabet
      `${'a'.repeat(63)}`, // odd-length hex that is not base64 either
    ]) {
      expect(() => loadConfig({ ...base, JWT_SECRET: bad }), bad).toThrow(/JWT_SECRET/);
      expect(() => loadConfig({ ...base, SERVER_PEPPER: bad }), bad).toThrow(/SERVER_PEPPER/);
    }
  });

  it('parses pool size and retention', () => {
    expect(loadConfig({ ...base, DB_POOL_MAX: '4', INSTALL_RETENTION_DAYS: '0' })).toMatchObject({
      dbPoolMax: 4,
      installRetentionDays: 0,
    });
    expect(() => loadConfig({ ...base, DB_POOL_MAX: '0' })).toThrow(/DB_POOL_MAX/);
    expect(() => loadConfig({ ...base, INSTALL_RETENTION_DAYS: '-1' })).toThrow(
      /INSTALL_RETENTION_DAYS/,
    );
  });
  it('treats empty strings as unset', () => {
    const c = loadConfig({ ...base, APP_VERSION: '', PORT: '' });
    expect(c.port).toBe(3000);
  });

  it('honours APP_VERSION', () => {
    expect(loadConfig({ ...base, APP_VERSION: '9.9.9' }).appVersion).toBe('9.9.9');
  });
});

describe('CLI configs', () => {
  const url = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('loadDbConfig needs only DATABASE_URL', () => {
    expect(loadDbConfig(url)).toEqual({ databaseUrl: url.DATABASE_URL, dbPoolMax: 10 });
    expect(() => loadDbConfig({})).toThrow(ConfigError);
  });

  it('loadRulePackCliConfig requires exactly 32 raw bytes in canonical base64', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    expect(loadRulePackCliConfig({ ...url, RULEPACK_PUBLIC_KEY: key }).rulepackPublicKey).toEqual(
      Buffer.alloc(32, 1),
    );
    for (const bad of [
      'AAAA',
      key.replace(/=+$/, ''),
      Buffer.alloc(33, 1).toString('base64'),
      Buffer.alloc(31, 1).toString('base64'),
      `${key}
`,
    ]) {
      expect(() => loadRulePackCliConfig({ ...url, RULEPACK_PUBLIC_KEY: bad }), bad).toThrow(
        /RULEPACK_PUBLIC_KEY/,
      );
    }
    expect(() => loadRulePackCliConfig(url)).toThrow(/RULEPACK_PUBLIC_KEY/);
  });

  it('loadRetentionDays defaults to 180', () => {
    expect(loadRetentionDays({})).toBe(180);
    expect(loadRetentionDays({ INSTALL_RETENTION_DAYS: '30' })).toBe(30);
  });
});
