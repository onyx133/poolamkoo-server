import { readFileSync } from 'node:fs';
import { z } from 'zod';

export type TrustProxy = boolean | number | string[];

// Days before an install that has not been seen is deleted; 0 disables the clean-up.
export const retentionDays = z.coerce.number().int().min(0).max(36500);

const boolString = z.enum(['true', 'false']).transform((v) => v === 'true');

// Hex (even length) or canonical base64 (padded, standard alphabet). "Canonical" means the
// value re-encodes to itself, so a typo'd or truncated secret cannot silently decode to fewer
// bytes than it looks like it has. Returns null when the value is neither.
function decodeStrict(value: string): Buffer | null {
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}

const secretBytes = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const decoded = decodeStrict(value);
    if (decoded === null) {
      ctx.addIssue({ code: 'custom', message: 'must be canonical base64 or hex' });
      return z.NEVER;
    }
    if (decoded.length < 32) {
      ctx.addIssue({ code: 'custom', message: 'must decode to at least 32 bytes' });
      return z.NEVER;
    }
    return decoded;
  });

// Raw 32-byte Ed25519 public key as canonical base64.
const publicKeyBytes = z.string().transform((value, ctx) => {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || decoded.length !== 32) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be canonical base64 of a raw 32-byte Ed25519 public key',
    });
    return z.NEVER;
  }
  return decoded;
});

function parseTrustProxy(value: string): TrustProxy {
  const v = value.trim();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const dbEnv = {
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ...dbEnv,
  SERVER_PEPPER: secretBytes,
  JWT_SECRET: secretBytes,
  JWT_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TRUST_PROXY: z.string().default('false').transform(parseTrustProxy),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  DOCS_ENABLED: boolString.default(true),
  INSTALL_RETENTION_DAYS: retentionDays.default(180),
  APP_VERSION: z.string().optional(),
});

export interface Config {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly dbPoolMax: number;
  readonly serverPepper: Buffer;
  readonly jwtSecret: Buffer;
  readonly jwtTtlDays: number;
  readonly trustProxy: TrustProxy;
  readonly rateLimitMax: number;
  readonly docsEnabled: boolean;
  readonly installRetentionDays: number;
  readonly appVersion: string;
}

function packageVersion(): string {
  // Works from src/ (tsx) and dist/ (node): package.json is one level up.
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

export class ConfigError extends Error {}

// Empty strings (e.g. `APP_VERSION=` copied from .env.example) count as unset.
function parseEnv<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.output<T> {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = parseEnv(envSchema, env);
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    serverPepper: e.SERVER_PEPPER,
    jwtSecret: e.JWT_SECRET,
    jwtTtlDays: e.JWT_TTL_DAYS,
    trustProxy: e.TRUST_PROXY,
    rateLimitMax: e.RATE_LIMIT_MAX,
    docsEnabled: e.DOCS_ENABLED,
    installRetentionDays: e.INSTALL_RETENTION_DAYS,
    appVersion: e.APP_VERSION ?? packageVersion(),
  });
}

// Operator CLIs need the database and nothing else (no pepper, no JWT secret).
export interface DbConfig {
  readonly databaseUrl: string;
  readonly dbPoolMax: number;
}

const dbEnvSchema = z.object(dbEnv);

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const e = parseEnv(dbEnvSchema, env);
  return Object.freeze({ databaseUrl: e.DATABASE_URL, dbPoolMax: e.DB_POOL_MAX });
}

export interface RulePackCliConfig extends DbConfig {
  readonly rulepackPublicKey: Buffer;
}

/** `rulepack:import`: the database plus the key packs are verified against. */
export function loadRulePackCliConfig(env: NodeJS.ProcessEnv = process.env): RulePackCliConfig {
  const e = parseEnv(z.object({ ...dbEnv, RULEPACK_PUBLIC_KEY: publicKeyBytes }), env);
  return Object.freeze({
    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    rulepackPublicKey: e.RULEPACK_PUBLIC_KEY,
  });
}

/** `installs:prune`: the retention period from the environment (the API's own default). */
export function loadRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  return parseEnv(z.object({ INSTALL_RETENTION_DAYS: retentionDays.default(180) }), env)
    .INSTALL_RETENTION_DAYS;
}
