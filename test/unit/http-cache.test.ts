import { describe, expect, it } from 'vitest';
import { matchesIfNoneMatch } from '../../src/lib/http-cache.js';

const etag = '"bands-3"';

describe('matchesIfNoneMatch', () => {
  it.each([
    ['exact', '"bands-3"'],
    ['weak prefix on the header', 'W/"bands-3"'],
    ['wildcard', '*'],
    ['list with the tag last', '"bands-1", "bands-2", "bands-3"'],
    ['list with the tag first, no spaces', '"bands-3","bands-9"'],
    ['list mixing weak tags', 'W/"x", W/"bands-3"'],
    ['surrounding whitespace', '  "bands-3"  '],
    ['wildcard inside a list', '"nope", *'],
  ])('matches: %s', (_name, header) => {
    expect(matchesIfNoneMatch(header, etag)).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['other version', '"bands-2"'],
    ['prefix only', '"bands-"'],
    ['unquoted value', 'bands-3'],
    ['list without it', '"bands-1", W/"bands-2"'],
  ])('does not match: %s', (_name, header) => {
    expect(matchesIfNoneMatch(header, etag)).toBe(false);
  });

  it('applies weak comparison to a weak server etag too', () => {
    expect(matchesIfNoneMatch('"bands-3"', 'W/"bands-3"')).toBe(true);
  });

  it('keeps commas inside quoted tags intact', () => {
    expect(matchesIfNoneMatch('"a,b"', '"a,b"')).toBe(true);
    expect(matchesIfNoneMatch('"a,b"', '"a"')).toBe(false);
  });
});
