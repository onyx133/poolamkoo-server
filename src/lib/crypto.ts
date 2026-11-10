import { createHmac } from 'node:crypto';

// Hex HMAC-SHA256(install_id, SERVER_PEPPER). The UUID is lower-cased first so that the
// same id in a different letter case maps to the same install.
export function hmacInstallId(installId: string, pepper: Buffer): string {
  return createHmac('sha256', pepper).update(installId.toLowerCase()).digest('hex');
}
