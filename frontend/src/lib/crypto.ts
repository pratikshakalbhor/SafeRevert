import { keccak256, toBytes, type Hex } from 'viem';

export const ZERO_SECRET_HASH: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Generates a cryptographically strong 32-byte secret encoded as a 64-character hex string.
 * This hex string itself is treated as the Solidity `string` secret.
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Normalizes user input for a secret string.
 * Trims whitespace. If a 66-character string starting with '0x' is passed,
 * trims '0x' to keep the exact 64-character secret string.
 */
export function normalizeSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.startsWith('0x') && trimmed.length === 66) {
    return trimmed.slice(2);
  }
  return trimmed;
}

/**
 * Computes `secretHash = keccak256(toBytes(secret))` matching the on-chain:
 * `keccak256(abi.encodePacked(secret))` where `secret` is a Solidity string.
 */
export function computeSecretHash(secret: string): Hex {
  const normalized = normalizeSecret(secret);
  if (!normalized) {
    return ZERO_SECRET_HASH;
  }
  // toBytes on a string not starting with 0x returns UTF-8 bytes (ASCII representation of the 64 hex chars)
  return keccak256(toBytes(normalized));
}

/**
 * Pre-checks a secret against an on-chain secret hash before sending a transaction.
 * Returns true if the transfer has no secret (zero hash) or if the computed hash matches.
 */
export function isSecretValid(secret: string, expectedHash: Hex): boolean {
  if (expectedHash === ZERO_SECRET_HASH) {
    return true;
  }
  const normalized = normalizeSecret(secret);
  if (!normalized) return false;
  const hash = computeSecretHash(normalized);
  return hash.toLowerCase() === expectedHash.toLowerCase();
}
