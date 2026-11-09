import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

// Fixed DER prefixes (RFC 8410) for raw 32-byte Ed25519 keys.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const RAW_KEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;
// 64 bytes encode to exactly 86 base64 characters plus "==".
const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

export class Ed25519Error extends Error {}

/** Public key from the raw 32-byte form (what Tink and `RULEPACK_PUBLIC_KEY` use). */
export function publicKeyFromRaw(raw: Uint8Array): KeyObject {
  if (raw.length !== RAW_KEY_LENGTH) {
    throw new Ed25519Error('Ed25519 public key must be exactly 32 bytes');
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

/** Private key from the raw 32-byte seed. */
export function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== RAW_KEY_LENGTH) {
    throw new Ed25519Error('Ed25519 seed must be exactly 32 bytes');
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function privateKeyFromPem(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    throw new Ed25519Error('Not a valid PEM private key');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Ed25519Error('Private key is not an Ed25519 key');
  }
  return key;
}

/** Raw 32-byte public key of a public or private Ed25519 key object. */
export function rawPublicKey(key: KeyObject): Buffer {
  const pub = key.type === 'private' ? createPublicKey(key) : key;
  const spki = pub.export({ format: 'der', type: 'spki' });
  return Buffer.from(spki.subarray(spki.length - RAW_KEY_LENGTH));
}

export interface GeneratedKeyPair {
  /** PKCS#8 PEM; keep it secret. */
  privatePem: string;
  /** Raw 32-byte public key, for `RULEPACK_PUBLIC_KEY` (base64) and the app. */
  publicRaw: Buffer;
}

export function generateKeyPair(): GeneratedKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicRaw: rawPublicKey(publicKey),
  };
}

/** Detached Ed25519 signature over the exact bytes, base64 encoded. */
export function signDetached(payload: Uint8Array, privateKey: KeyObject): string {
  return sign(null, payload, privateKey).toString('base64');
}

/** True only for a well-formed base64 signature that verifies; never throws. */
export function verifyDetached(
  payload: Uint8Array,
  signatureBase64: string,
  publicKey: KeyObject,
): boolean {
  if (!SIGNATURE_BASE64.test(signatureBase64)) return false;
  const signature = Buffer.from(signatureBase64, 'base64');
  if (signature.length !== SIGNATURE_LENGTH) return false;
  try {
    return verify(null, payload, publicKey, signature);
  } catch {
    return false;
  }
}
