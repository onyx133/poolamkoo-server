import { createPublicKey } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Ed25519Error,
  generateKeyPair,
  privateKeyFromPem,
  privateKeyFromSeed,
  publicKeyFromRaw,
  rawPublicKey,
  signDetached,
  verifyDetached,
} from '../../src/lib/ed25519.js';
import { isInsideWorkTree } from '../../src/lib/fs-safety.js';
import { matchesIfNoneMatch } from '../../src/lib/http-cache.js';

// RFC 8032 section 7.1, test 1 (empty message).
const RFC_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RFC_PUBLIC = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC_SIGNATURE =
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

// Produced once with `openssl genpkey -algorithm ed25519` and
// `openssl pkeyutl -sign -rawin` (throwaway key, private half intentionally not kept).
const OPENSSL_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0l+FwcSILZoLS9Pduavtujbre5w+wN++Wlg9mlEjDu0=
-----END PUBLIC KEY-----`;
const OPENSSL_MESSAGE = 'poolamkoo-test-payload';
const OPENSSL_SIGNATURE =
  'Gh4mFzfXrgLQCrQUHbxPwp5a3DBizBn7mO9rF0iAUZTIS2fxDk5ZoF2A2CR0GFJBE5hs1VKPjCvQoVDGB88nAw==';

describe('ed25519 helpers', () => {
  it('matches the RFC 8032 test 1 vector for raw keys', () => {
    const priv = privateKeyFromSeed(Buffer.from(RFC_SEED, 'hex'));
    expect(rawPublicKey(priv).toString('hex')).toBe(RFC_PUBLIC);

    const signature = signDetached(Buffer.alloc(0), priv);
    expect(Buffer.from(signature, 'base64').toString('hex')).toBe(RFC_SIGNATURE);

    const pub = publicKeyFromRaw(Buffer.from(RFC_PUBLIC, 'hex'));
    expect(verifyDetached(Buffer.alloc(0), signature, pub)).toBe(true);
    expect(verifyDetached(Buffer.from('x'), signature, pub)).toBe(false);
  });

  it('verifies a signature produced by openssl with an openssl SPKI key', () => {
    const fromPem = createPublicKey(OPENSSL_PUBLIC_PEM);
    const message = Buffer.from(OPENSSL_MESSAGE);
    expect(verifyDetached(message, OPENSSL_SIGNATURE, fromPem)).toBe(true);

    // The same key through the raw 32-byte form used by RULEPACK_PUBLIC_KEY.
    const fromRaw = publicKeyFromRaw(rawPublicKey(fromPem));
    expect(verifyDetached(message, OPENSSL_SIGNATURE, fromRaw)).toBe(true);
    expect(verifyDetached(Buffer.from('tampered'), OPENSSL_SIGNATURE, fromRaw)).toBe(false);
  });

  it('round-trips a generated keypair through PKCS#8 PEM', () => {
    const { privatePem, publicRaw } = generateKeyPair();
    expect(privatePem).toContain('BEGIN PRIVATE KEY');
    expect(publicRaw).toHaveLength(32);

    const priv = privateKeyFromPem(privatePem);
    expect(rawPublicKey(priv).equals(publicRaw)).toBe(true);
    const payload = Buffer.from('{"formatVersion":1}');
    const sig = signDetached(payload, priv);
    expect(sig).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    expect(verifyDetached(payload, sig, publicKeyFromRaw(publicRaw))).toBe(true);
  });

  it('rejects wrong lengths, bad PEM and non-ed25519 keys', () => {
    expect(() => publicKeyFromRaw(Buffer.alloc(31))).toThrow(Ed25519Error);
    expect(() => privateKeyFromSeed(Buffer.alloc(33))).toThrow(Ed25519Error);
    expect(() => privateKeyFromPem('nonsense')).toThrow(Ed25519Error);
  });

  it('treats malformed signatures as invalid instead of throwing', () => {
    const { privatePem, publicRaw } = generateKeyPair();
    const pub = publicKeyFromRaw(publicRaw);
    const payload = Buffer.from('payload');
    const good = signDetached(payload, privateKeyFromPem(privatePem));
    expect(verifyDetached(payload, good, pub)).toBe(true);
    for (const bad of ['', 'AAAA', good.slice(0, -4), `${good}\n`, good.replace(/.$/, '!')]) {
      expect(verifyDetached(payload, bad, pub)).toBe(false);
    }
    const other = generateKeyPair();
    expect(verifyDetached(payload, good, publicKeyFromRaw(other.publicRaw))).toBe(false);
  });
});

describe('matchesIfNoneMatch', () => {
  const tag = '"catalog-3"';
  it('matches strong, weak, list and wildcard forms', () => {
    expect(matchesIfNoneMatch('"catalog-3"', tag)).toBe(true);
    expect(matchesIfNoneMatch('W/"catalog-3"', tag)).toBe(true);
    expect(matchesIfNoneMatch('"a", W/"catalog-3" , "b"', tag)).toBe(true);
    expect(matchesIfNoneMatch('*', tag)).toBe(true);
  });
  it('does not match other tags, garbage or a missing header', () => {
    expect(matchesIfNoneMatch(undefined, tag)).toBe(false);
    expect(matchesIfNoneMatch('', tag)).toBe(false);
    expect(matchesIfNoneMatch('"catalog-2"', tag)).toBe(false);
    expect(matchesIfNoneMatch('catalog-3', tag)).toBe(false);
    expect(matchesIfNoneMatch('"catalog-33"', tag)).toBe(false);
  });
});

describe('isInsideWorkTree', () => {
  it('detects git working trees and the extra root, allows plain directories', () => {
    const base = mkdtempSync(join(tmpdir(), 'pk-fs-'));
    try {
      const plain = join(base, 'plain');
      const repo = join(base, 'repo');
      mkdirSync(plain);
      mkdirSync(join(repo, '.git'), { recursive: true });
      mkdirSync(join(repo, 'sub'));
      expect(isInsideWorkTree(join(plain, 'key.pem'))).toBe(false);
      expect(isInsideWorkTree(join(repo, 'key.pem'))).toBe(true);
      expect(isInsideWorkTree(join(repo, 'sub', 'deep', 'key.pem'))).toBe(true);
      expect(isInsideWorkTree(join(plain, 'key.pem'), plain)).toBe(true);
      expect(isInsideWorkTree(join(base, 'plain-two', 'key.pem'), plain)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
