import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  generateKeyPair,
  privateKeyFromPem,
  publicKeyFromRaw,
  signDetached,
  verifyDetached,
} from '../../src/lib/ed25519.js';
import {
  importRulePack,
  RulePackImportError,
} from '../../src/modules/rule-packs/rule-packs.importer.js';
import { PrismaRulePacksRepository } from '../../src/modules/rule-packs/rule-packs.repository.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { resetDb } from '../helpers/db.js';

const pair = generateKeyPair();
const priv = privateKeyFromPem(pair.privatePem);
const publicKey = publicKeyFromRaw(pair.publicRaw);

// Tiny synthetic pack; the odd whitespace proves bytes are served verbatim.
const pack = (version: number, minAppVersion: number) =>
  Buffer.from(
    `{ "formatVersion": 1,\n  "version": ${version}, "minAppVersion": ${minAppVersion},\n` +
      `  "banks": [], "rules": [], "nonTransactions": [] }\n`,
  );

describe('rule packs', () => {
  let t: TestApp;
  let repo: PrismaRulePacksRepository;
  beforeAll(async () => {
    t = await buildTestApp();
    repo = new PrismaRulePacksRepository(t.prisma);
  });
  afterAll(() => t.close());
  beforeEach(() => resetDb(t.prisma));

  const publish = (payload: Buffer) =>
    importRulePack(repo, { payload, signature: signDetached(payload, priv), publicKey });
  const latest = (query: string, headers: Record<string, string> = {}) =>
    t.app.inject({ method: 'GET', url: `/v1/rule-packs/latest${query}`, headers });

  it('is 404 (problem) when no pack exists', async () => {
    const res = await latest('?app_version=100');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404 });
  });

  it('returns the exact stored bytes and a signature that verifies', async () => {
    const payload = pack(1, 0);
    await publish(payload);
    const res = await latest('?app_version=1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.rawPayload.equals(payload)).toBe(true);
    expect(res.headers['x-rule-pack-version']).toBe('1');
    expect(res.headers['etag']).toBe('"rulepack-1"');
    expect(res.headers['cache-control']).toBe('public, max-age=300');

    const signature = String(res.headers['x-signature']);
    expect(verifyDetached(res.rawPayload, signature, publicKey)).toBe(true);
    expect(verifyDetached(Buffer.from('other'), signature, publicKey)).toBe(false);
    // Same base64 the app would feed to Tink.
    expect(Buffer.from(signature, 'base64')).toHaveLength(64);
  });

  it('is public and selects the newest pack the app version supports', async () => {
    await publish(pack(1, 0));
    await publish(pack(2, 100));
    const at = async (v: number) =>
      (await latest(`?app_version=${v}`)).headers['x-rule-pack-version'];
    expect(await at(0)).toBe('1');
    expect(await at(99)).toBe('1');
    expect(await at(100)).toBe('2');
    expect(await at(5000)).toBe('2');

    await t.prisma.rulePack.deleteMany({ where: { version: 1 } });
    expect((await latest('?app_version=99')).statusCode).toBe(404);
    expect((await latest('?app_version=100')).statusCode).toBe(200);
  });

  it('answers 304 for a matching If-None-Match and keeps the headers', async () => {
    await publish(pack(1, 0));
    for (const header of ['"rulepack-1"', 'W/"rulepack-1"', '"a", "rulepack-1"', '*']) {
      const res = await latest('?app_version=1', { 'if-none-match': header });
      expect(res.statusCode, header).toBe(304);
      expect(res.body).toBe('');
      expect(res.headers['x-rule-pack-version']).toBe('1');
      expect(res.headers['etag']).toBe('"rulepack-1"');
    }
    expect((await latest('?app_version=1', { 'if-none-match': '"rulepack-0"' })).statusCode).toBe(
      200,
    );
  });

  it('serves a newer pack under a new ETag', async () => {
    await publish(pack(1, 0));
    await publish(pack(2, 0));
    const res = await latest('?app_version=1', { 'if-none-match': '"rulepack-1"' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBe('"rulepack-2"');
  });

  it('rejects a missing, negative, fractional or malformed app_version with 400', async () => {
    await publish(pack(1, 0));
    for (const query of [
      '',
      '?app_version=',
      '?app_version=-1',
      '?app_version=1.5',
      '?app_version=abc',
      '?app_version=1e3',
      '?app_version=0x10',
      '?app_version=%201',
      '?app_version=99999999999',
      '?app_version=1&app_version=2',
      '?app_version=1&extra=1',
    ]) {
      const res = await latest(query);
      expect(res.statusCode, query).toBe(400);
      expect(res.json()).toMatchObject({
        type: 'urn:poolamkoo:problem:validation',
        status: 400,
      });
    }
  });

  it('refuses packs with a bad signature at import and stores nothing', async () => {
    const payload = pack(1, 0);
    const other = privateKeyFromPem(generateKeyPair().privatePem);
    await expect(
      importRulePack(repo, { payload, signature: signDetached(payload, other), publicKey }),
    ).rejects.toThrow(RulePackImportError);
    await expect(
      importRulePack(repo, {
        payload: Buffer.concat([payload, Buffer.from(' ')]),
        signature: signDetached(payload, priv),
        publicKey,
      }),
    ).rejects.toThrow(/signature/);
    expect(await t.prisma.rulePack.count()).toBe(0);
    expect((await latest('?app_version=1')).statusCode).toBe(404);
  });

  it('refuses a version that is not newer than the latest stored one', async () => {
    await publish(pack(3, 0));
    await expect(publish(pack(3, 0))).rejects.toThrow(/greater than/);
    await expect(publish(pack(2, 0))).rejects.toThrow(/greater than/);
    expect(await t.prisma.rulePack.count()).toBe(1);
  });

  it('stores the metadata columns and sha256', async () => {
    await publish(pack(7, 42));
    const row = await t.prisma.rulePack.findUniqueOrThrow({ where: { version: 7 } });
    expect(row).toMatchObject({ formatVersion: 1, minAppVersion: 42 });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(row.payload).equals(pack(7, 42))).toBe(true);
  });

  it('documents the custom response headers in OpenAPI', async () => {
    const spec = t.app.swagger() as {
      paths: Record<
        string,
        { get: { tags: string[]; responses: Record<string, OpenApiResponse> } }
      >;
    };
    const op = spec.paths['/v1/rule-packs/latest']!.get;
    expect(op.tags).toEqual(['rule-packs']);
    expect(Object.keys(op.responses['200']!.headers)).toEqual(
      expect.arrayContaining(['X-Rule-Pack-Version', 'X-Signature', 'ETag']),
    );
    expect(op.responses['304']).toBeDefined();
  });
});

interface OpenApiResponse {
  headers: Record<string, unknown>;
  content: Record<string, { schema: { properties: Record<string, unknown> } }>;
}
