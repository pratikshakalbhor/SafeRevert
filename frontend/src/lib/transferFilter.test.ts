import { describe, it, expect } from 'vitest';
import { selectUserTransfers } from './transferFilter';
import { TransferState, type TransferRecord } from './types';
import type { Address, Hex } from 'viem';

const USER = '0xAbC0000000000000000000000000000000000001' as Address;
const OTHER = '0xddE0000000000000000000000000000000000002' as Address;
const THIRD = '0xFFf0000000000000000000000000000000000003' as Address;

const record = (id: number, sender: Address, recipient: Address): TransferRecord => ({
  id: BigInt(id),
  sender,
  recipient,
  token: '0x0000000000000000000000000000000000000000' as Address,
  amount: 1_000_000_000_000_000n,
  unlockTime: 1_800_000_000n,
  expiry: 1_800_086_400n,
  secretHash: '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
  state: TransferState.Pending,
});

describe('selectUserTransfers', () => {
  it('keeps transfers where the account is sender', () => {
    const result = selectUserTransfers([record(1, USER, OTHER)], USER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1n);
  });

  it('keeps transfers where the account is recipient', () => {
    const result = selectUserTransfers([record(2, OTHER, USER)], USER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2n);
  });

  it('matches case-insensitively (checksummed vs lower-case)', () => {
    const result = selectUserTransfers([record(3, OTHER, USER)], USER.toLowerCase());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3n);
  });

  it('drops transfers the account is not part of', () => {
    const result = selectUserTransfers([record(4, OTHER, THIRD)], USER);
    expect(result).toHaveLength(0);
  });

  it('sorts newest first (highest id first)', () => {
    const input = [
      record(7, USER, THIRD),
      record(12, OTHER, USER),
      record(3, USER, OTHER),
      record(9, OTHER, USER),
    ];
    const result = selectUserTransfers(input, USER);
    expect(result.map((t) => t.id)).toEqual([12n, 9n, 7n, 3n]);
  });

  it('does not mutate the input array', () => {
    const input = [record(1, USER, OTHER), record(5, OTHER, USER)];
    const snapshot = input.map((t) => t.id);
    selectUserTransfers(input, USER);
    expect(input.map((t) => t.id)).toEqual(snapshot);
  });

  it('returns an empty list for an empty/blank account', () => {
    const input = [record(1, USER, OTHER)];
    expect(selectUserTransfers(input, '')).toEqual([]);
    expect(selectUserTransfers(input, '   ')).toEqual([]);
  });

  it('handles an empty transfer list', () => {
    expect(selectUserTransfers([], USER)).toEqual([]);
  });
});
