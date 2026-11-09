import { readFileSync } from 'node:fs';
import { z } from 'zod';

export type TrustProxy = boolean | number | string[];

const boolString = z.enum(['true', 'false']).transform((v) => v === 'true');

// Accepts hex or base64; the decoded secret must be at least 32 bytes.
function decodeSecret(value: string): Buffer {
  const isHex = /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
  return Buffer.from(value, isHex ? 'hex' : 'base64');
}

const secretBytes = z
  .string()
  .min(1)
  .transform(decodeSecret)
  .refine((b) => b.length >= 32, 'must decode to at least 32 bytes (base64 or hex)');

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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  SERVER_PEPPER: secretBytes,
  JWT_SECRET: secretBytes,
  JWT_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TRUST_PROXY: z.string().default('false').transform(parseTrustProxy),
  RULEPACK_PUBLIC_KEY: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : Buffer.from(v, 'base64')))
    .refine((b) => b === undefined || b.length === 32, 'must be a base64 raw 32-byte Ed25519 key'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  DOCS_ENABLED: boolString.default(true),
  APP_VERSION: z.string().optional(),
});

export interface Config {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly serverPepper: Buffer;
  readonly jwtSecret: Buffer;
  readonly jwtTtlDays: number;
  readonly trustProxy: TrustProxy;
  readonly rulepackPublicKey: Buffer | undefined;
  readonly rateLimitMax: number;
  readonly docsEnabled: boolean;
  readonly appVersion: string;
}

function packageVersion(): string {
  // Works from src/ (tsx) and dist/ (node): package.json is one level up.
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Empty strings (e.g. `APP_VERSION=` copied from .env.example) count as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    serverPepper: e.SERVER_PEPPER,
    jwtSecret: e.JWT_SECRET,
    jwtTtlDays: e.JWT_TTL_DAYS,
    trustProxy: e.TRUST_PROXY,
    rulepackPublicKey: e.RULEPACK_PUBLIC_KEY,
    rateLimitMax: e.RATE_LIMIT_MAX,
    docsEnabled: e.DOCS_ENABLED,
    appVersion: e.APP_VERSION ?? packageVersion(),
  });
}
