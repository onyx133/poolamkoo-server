import { describe, expect, it } from 'vitest';
import { ipRateLimitKey } from '../../src/lib/ip.js';

describe('ipRateLimitKey', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(ipRateLimitKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('maps IPv4-mapped IPv6 addresses to IPv4', () => {
    expect(ipRateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('puts every address of one /64 in the same bucket', () => {
    const a = ipRateLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const b = ipRateLimitKey('2001:db8:1:2::1');
    const c = ipRateLimitKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('separates different /64 prefixes', () => {
    expect(ipRateLimitKey('2001:db8:1:2::1')).not.toBe(ipRateLimitKey('2001:db8:1:3::1'));
  });

  it('never collides an IPv6 bucket with an IPv4 one', () => {
    expect(ipRateLimitKey('2001:db8:1:2::1')).toContain(':');
    expect(ipRateLimitKey('203.0.113.7')).not.toContain(':');
  });
});
