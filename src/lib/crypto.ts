import { createHmac, timingSafeEqual } from 'node:crypto';

// Hex HMAC-SHA256(install_id, SERVER_PEPPER). The UUID is lower-cased first so that the
// same id in a different letter case maps to the same install.
export function hmacInstallId(installId: string, pepper: Buffer): string {
  return createHmac('sha256', pepper).update(installId.toLowerCase()).digest('hex');
}

// Constant-time string comparison (length differences are not secret here).
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
