import { describe, expect, it } from 'vitest';
import { hmacInstallId, safeEqual } from '../../src/lib/crypto.js';

const pepper = Buffer.alloc(32, 1);
const id = '3f0c1c52-7a1e-4d0e-9a39-0f6f5f2a8c11';

describe('hmacInstallId', () => {
  it('is deterministic 64-char hex and does not contain the id', () => {
    const h = hmacInstallId(id, pepper);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacInstallId(id, pepper)).toBe(h);
    expect(h).not.toContain(id);
  });

  it('depends on the pepper and the id', () => {
    expect(hmacInstallId(id, Buffer.alloc(32, 2))).not.toBe(hmacInstallId(id, pepper));
    expect(hmacInstallId(id.replace('3f0c', '3f0d'), pepper)).not.toBe(hmacInstallId(id, pepper));
  });

  it('ignores letter case of the uuid', () => {
    expect(hmacInstallId(id.toUpperCase(), pepper)).toBe(hmacInstallId(id, pepper));
  });

  it('matches a known HMAC-SHA256 vector', () => {
    // openssl: printf 'x' | openssl dgst -sha256 -hmac 'key'
    expect(hmacInstallId('x', Buffer.from('key'))).toBe(
      '4fc3b7eaf34d7e594a6f51d9517ba543abf41067b27587ffd82ba3584e4d3cdd',
    );
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal strings, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
