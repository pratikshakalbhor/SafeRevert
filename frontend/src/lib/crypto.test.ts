import { describe, it, expect } from 'vitest';
import {
  generateSecret,
  computeSecretHash,
  isSecretValid,
  ZERO_SECRET_HASH,
  normalizeSecret,
} from './crypto';
import { keccak256, stringToBytes } from 'viem';

describe('crypto helpers', () => {
  it('generates a 64-character hex secret of 32 random bytes', () => {
    const s1 = generateSecret();
    const s2 = generateSecret();

    expect(s1).toHaveLength(64);
    expect(s2).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(s1)).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(s2)).toBe(true);
    // Cryptographically independent
    expect(s1).not.toBe(s2);
  });

  it('normalizes secret input safely', () => {
    const raw = '4f8a1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
    expect(normalizeSecret(`  ${raw}  `)).toBe(raw);
    expect(normalizeSecret(`0x${raw}`)).toBe(raw);
  });

  it('computes secretHash matching Solidity keccak256(abi.encodePacked(secret))', () => {
    // Test known vector from SafeRevertVault.t.sol:
    // bytes32 constant SECRET_HASH = keccak256(abi.encodePacked("s3cret"));
    const secret = 's3cret';
    const expected = keccak256(stringToBytes(secret));
    const computed = computeSecretHash(secret);
    expect(computed).toBe(expected);

    // Test with a 64-char random hex string
    const hexSecret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const expectedHexHash = keccak256(stringToBytes(hexSecret));
    expect(computeSecretHash(hexSecret)).toBe(expectedHexHash);
  });

  it('handles empty secret as ZERO_SECRET_HASH', () => {
    expect(computeSecretHash('')).toBe(ZERO_SECRET_HASH);
    expect(computeSecretHash('   ')).toBe(ZERO_SECRET_HASH);
  });

  it('verifies secret matches hash before sending tx', () => {
    const secret = '4f8a1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
    const hash = computeSecretHash(secret);

    // Correct secret matches
    expect(isSecretValid(secret, hash)).toBe(true);

    // Wrong secret fails pre-check
    expect(isSecretValid('wrongsecret', hash)).toBe(false);

    // Zero secret hash (no secret check required) allows any secret or empty
    expect(isSecretValid('', ZERO_SECRET_HASH)).toBe(true);
    expect(isSecretValid('anything', ZERO_SECRET_HASH)).toBe(true);
  });
});
