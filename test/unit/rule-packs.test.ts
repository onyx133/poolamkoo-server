import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run as keygen } from '../../src/cli/rulepack-keygen.js';
import { run as signCli } from '../../src/cli/rulepack-sign.js';
import {
  generateKeyPair,
  privateKeyFromPem,
  publicKeyFromRaw,
  verifyDetached,
  signDetached,
} from '../../src/lib/ed25519.js';
import {
  importRulePack,
  RulePackImportError,
} from '../../src/modules/rule-packs/rule-packs.importer.js';
import type {
  InsertRulePackResult,
  NewRulePack,
  RulePacksRepository,
  StoredRulePack,
} from '../../src/modules/rule-packs/rule-packs.repository.js';

class FakeRepo implements RulePacksRepository {
  rows: NewRulePack[] = [];
  latestFor(): Promise<StoredRulePack | null> {
    return Promise.resolve(null);
  }
  insertIfNewer(pack: NewRulePack): Promise<InsertRulePackResult> {
    const latest = this.rows.reduce<number | null>((m, r) => Math.max(m ?? 0, r.version), null);
    if (latest !== null && pack.version <= latest) {
      return Promise.resolve({ inserted: false, latest });
    }
    this.rows.push(pack);
    return Promise.resolve({ inserted: true });
  }
}

const pair = generateKeyPair();
const priv = privateKeyFromPem(pair.privatePem);
const publicKey = publicKeyFromRaw(pair.publicRaw);

const packJson = (over: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      version: 1,
      minAppVersion: 0,
      banks: [],
      rules: [],
      nonTransactions: [],
      ...over,
    }),
  );
const signed = (payload: Buffer) => ({
  payload,
  signature: signDetached(payload, priv),
  publicKey,
});

describe('importRulePack', () => {
  it('stores the exact bytes, signature and sha256', async () => {
    const repo = new FakeRepo();
    const payload = packJson({ version: 3, minAppVersion: 12 });
    const summary = await importRulePack(repo, signed(payload));
    expect(summary).toMatchObject({ version: 3, formatVersion: 1, minAppVersion: 12 });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]!.payload.equals(payload)).toBe(true);
    expect(verifyDetached(repo.rows[0]!.payload, repo.rows[0]!.signature, publicKey)).toBe(true);
    expect(repo.rows[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a signature with a trailing newline (as written by rulepack:sign)', async () => {
    const payload = packJson();
    const s = signed(payload);
    await importRulePack(new FakeRepo(), { ...s, signature: `${s.signature}\n` });
  });

  it('rejects a bad, foreign or missing signature before anything else', async () => {
    const repo = new FakeRepo();
    const payload = packJson();
    const other = generateKeyPair();
    const foreign = signDetached(payload, privateKeyFromPem(other.privatePem));
    for (const signature of ['', 'garbage', foreign, signDetached(packJson({ x: 1 }), priv)]) {
      await expect(importRulePack(repo, { payload, signature, publicKey })).rejects.toThrow(
        /signature/,
      );
    }
    // Not even a non-JSON body gets past the signature check with a wrong signature.
    await expect(
      importRulePack(repo, { payload: Buffer.from('nope'), signature: foreign, publicKey }),
    ).rejects.toThrow(/signature/);
    expect(repo.rows).toHaveLength(0);
  });

  it('requires JSON with three integer header fields', async () => {
    const repo = new FakeRepo();
    await expect(importRulePack(repo, signed(Buffer.from('not json')))).rejects.toThrow(/JSON/);
    const bad: Record<string, unknown>[] = [
      { formatVersion: '1' },
      { version: 1.5 },
      { minAppVersion: -1 },
      { minAppVersion: null },
      { version: 0 },
      { formatVersion: 0 },
      { version: 3_000_000_000 },
    ];
    for (const over of bad) {
      await expect(importRulePack(repo, signed(packJson(over)))).rejects.toThrow(
        RulePackImportError,
      );
    }
    await expect(importRulePack(repo, signed(Buffer.from('[]')))).rejects.toThrow(/header/);
    expect(repo.rows).toHaveLength(0);
  });

  it('refuses a version that is not newer than the latest stored one', async () => {
    const repo = new FakeRepo();
    await importRulePack(repo, signed(packJson({ version: 5 })));
    await expect(importRulePack(repo, signed(packJson({ version: 5 })))).rejects.toThrow(
      /greater than/,
    );
    await expect(importRulePack(repo, signed(packJson({ version: 4 })))).rejects.toThrow(
      /greater than/,
    );
    await importRulePack(repo, signed(packJson({ version: 6 })));
    expect(repo.rows).toHaveLength(2);
  });
});

describe('rulepack CLIs', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pk-cli-'));
    mkdirSync(join(dir, 'project'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('keygen writes a PEM outside the repo and prints the raw public key', () => {
    const out = join(dir, 'keys', 'private.pem');
    const publicB64 = keygen(['--out', out], join(dir, 'project'));
    expect(Buffer.from(publicB64, 'base64')).toHaveLength(32);
    expect(readFileSync(out, 'utf8')).toContain('BEGIN PRIVATE KEY');
    // Never overwrites.
    expect(() => keygen(['--out', out], join(dir, 'project'))).toThrow(/already exists/);
  });

  it('keygen refuses paths inside the project or any git working tree', () => {
    const project = join(dir, 'project');
    const repo = join(dir, 'other-repo');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(repo, '.git'), { recursive: true });
    expect(() => keygen(['--out', join(project, 'k.pem')], project)).toThrow(/working tree/);
    expect(() => keygen(['--out', join(repo, 'sub', 'k.pem')], project)).toThrow(/working tree/);
    expect(existsSync(join(project, 'k.pem'))).toBe(false);
    expect(existsSync(join(repo, 'sub'))).toBe(false);
    expect(() => keygen([], project)).toThrow(/Usage/);
  });

  it('sign writes <pack>.sig that verifies over the exact file bytes', async () => {
    const keyPath = join(dir, 'sign-key.pem');
    const publicB64 = keygen(['--out', keyPath], join(dir, 'project'));
    const pack = join(dir, 'pack.json');
    // Deliberately odd whitespace: the signature covers the bytes as they are on disk.
    writeFileSync(pack, '{ "formatVersion": 1,\r\n "version": 1, "minAppVersion": 0 }\n');
    const sigPath = await signCli([pack, '--key', keyPath]);
    expect(sigPath).toBe(`${pack}.sig`);
    const sig = readFileSync(sigPath, 'utf8').trim();
    const key = publicKeyFromRaw(Buffer.from(publicB64, 'base64'));
    expect(verifyDetached(readFileSync(pack), sig, key)).toBe(true);
    await expect(signCli([pack])).rejects.toThrow(/Usage/);
    await expect(signCli([pack, '--key', join(dir, 'missing.pem')])).rejects.toThrow(/Cannot read/);
  });
});
