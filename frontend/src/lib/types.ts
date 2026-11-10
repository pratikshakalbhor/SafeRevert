import type { Address, Hex } from 'viem';

export const TransferState = {
  Pending: 0,
  Cancelled: 1,
  Claimed: 2,
  Refunded: 3,
} as const;

export type TransferState = (typeof TransferState)[keyof typeof TransferState];

export const STATE_LABELS: Record<TransferState, string> = {
  [TransferState.Pending]: 'Pending',
  [TransferState.Cancelled]: 'Cancelled',
  [TransferState.Claimed]: 'Claimed',
  [TransferState.Refunded]: 'Refunded',
};

export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export interface TransferRecord {
  id: bigint;
  sender: Address;
  recipient: Address;
  token: Address;
  amount: bigint;
  unlockTime: bigint; // uint64 timestamp in seconds
  expiry: bigint;     // uint64 timestamp in seconds
  secretHash: Hex;
  state: TransferState;
  tokenSymbol?: string;
  tokenDecimals?: number;
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  isNative: boolean;
}

export interface PresetDelay {
  label: string;
  seconds: number;
}

export interface PresetExpiry {
  label: string;
  secondsAfterUnlock: number;
}
