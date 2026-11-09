import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OffersFileError, parseOffersFile } from '../../src/modules/offers/offers.import.js';

const offer = (overrides: Record<string, unknown> = {}) => ({
  id: 'o_1',
  title_fa: 'عنوان',
  body_fa: 'متن',
  cta_fa: 'برو',
  url: 'https://example.com/a',
  bands: ['B1', 'B2'],
  starts_at: '2026-01-01T00:00:00Z',
  expires_at: '2027-01-01T00:00:00Z',
  ...overrides,
});
const file = (...offers: Record<string, unknown>[]) => JSON.stringify({ offers });

describe('parseOffersFile', () => {
  it('accepts the shipped example file', () => {
    const raw = readFileSync(new URL('../../seed/offers.example.json', import.meta.url), 'utf8');
    const parsed = parseOffersFile(raw);
    expect(parsed.offers.length).toBeGreaterThanOrEqual(2);
    expect(parsed.offers.every((o) => o.url.startsWith('https://example.com/'))).toBe(true);
  });

  it('defaults active to true and accepts an empty set', () => {
    expect(parseOffersFile(file(offer())).offers[0]?.active).toBe(true);
    expect(parseOffersFile(file(offer({ active: false }))).offers[0]?.active).toBe(false);
    expect(parseOffersFile(file()).offers).toEqual([]);
  });

  it.each([
    ['http url', offer({ url: 'http://example.com/a' }), 'offers.0.url'],
    ['non-url', offer({ url: 'not a url' }), 'offers.0.url'],
    ['javascript url', offer({ url: 'javascript:alert(1)' }), 'offers.0.url'],
    ['unknown band', offer({ bands: ['B9'] }), 'offers.0.bands'],
    ['empty bands', offer({ bands: [] }), 'offers.0.bands'],
    ['repeated band', offer({ bands: ['B1', 'B1'] }), 'offers.0.bands'],
    ['bad id', offer({ id: 'has space' }), 'offers.0.id'],
    ['long id', offer({ id: 'x'.repeat(65) }), 'offers.0.id'],
    ['empty title', offer({ title_fa: '  ' }), 'offers.0.title_fa'],
    ['bad date', offer({ starts_at: 'yesterday' }), 'offers.0.starts_at'],
    ['expiry before start', offer({ expires_at: '2025-01-01T00:00:00Z' }), 'offers.0.expires_at'],
    ['extra key', offer({ impressions: 1 }), 'offers.0'],
  ])('rejects %s', (_name, bad, path) => {
    expect(() => parseOffersFile(file(bad))).toThrow(OffersFileError);
    expect(() => parseOffersFile(file(bad))).toThrow(path);
  });

  it('rejects duplicate ids, wrong shape and invalid JSON', () => {
    expect(() => parseOffersFile(file(offer(), offer()))).toThrow(/unique/);
    expect(() => parseOffersFile('[]')).toThrow(OffersFileError);
    expect(() => parseOffersFile('{"offers":[],"x":1}')).toThrow(OffersFileError);
    expect(() => parseOffersFile('{nope')).toThrow(/not valid JSON/);
  });
});
