import { normalizeIP } from '@fastify/rate-limit';

// An IPv6 client usually controls a whole /64, so keying limits by the full address would let
// it rotate through 2^64 buckets. IPv4 stays as is; IPv4-mapped IPv6 addresses become IPv4.
export const IPV6_PREFIX_BITS = 64;

/** Rate-limit bucket for a client address: IPv4 as is, IPv6 reduced to its /64 prefix. */
export function ipRateLimitKey(ip: string): string {
  try {
    return normalizeIP(ip, IPV6_PREFIX_BITS);
  } catch {
    // Not a parseable address (never expected from Fastify); fall back to the raw value.
    return ip;
  }
}
