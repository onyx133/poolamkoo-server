import { createHash } from 'node:crypto';
import { z } from 'zod';
import { verifyDetached } from '../../lib/ed25519.js';
import type { KeyObject } from 'node:crypto';
import type { RulePacksRepository } from './rule-packs.repository.js';

export class RulePackImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulePackImportError';
  }
}

const INT32_MAX = 2_147_483_647;

// Only the three header fields are checked: the pack body is the app's business and the
// server stores the signed bytes verbatim.
const headerSchema = z.object({
  formatVersion: z.number().int().min(1).max(INT32_MAX),
  version: z.number().int().min(1).max(INT32_MAX),
  minAppVersion: z.number().int().min(0).max(INT32_MAX),
});

export interface RulePackImportSummary {
  version: number;
  formatVersion: number;
  minAppVersion: number;
  bytes: number;
  sha256: string;
}

/**
 * Verifies the signature over the exact bytes first, then the header ints, then stores the
 * bytes verbatim if the version is newer than everything stored (checked under a lock).
 */
export async function importRulePack(
  repo: RulePacksRepository,
  input: { payload: Buffer; signature: string; publicKey: KeyObject },
): Promise<RulePackImportSummary> {
  const signature = input.signature.trim();
  if (!verifyDetached(input.payload, signature, input.publicKey)) {
    throw new RulePackImportError('signature does not verify against RULEPACK_PUBLIC_KEY');
  }

  let json: unknown;
  try {
    json = JSON.parse(input.payload.toString('utf8'));
  } catch {
    throw new RulePackImportError('pack is not valid JSON');
  }
  const header = headerSchema.safeParse(json);
  if (!header.success) {
    const detail = header.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new RulePackImportError(`invalid pack header (${detail})`);
  }
  const { version, formatVersion, minAppVersion } = header.data;

  const sha256 = createHash('sha256').update(input.payload).digest('hex');
  const result = await repo.insertIfNewer({
    version,
    formatVersion,
    minAppVersion,
    payload: input.payload,
    signature,
    sha256,
  });
  if (!result.inserted) {
    throw new RulePackImportError(
      `version ${version} must be greater than the latest stored version (${result.latest})`,
    );
  }
  return { version, formatVersion, minAppVersion, bytes: input.payload.length, sha256 };
}
