import type { TransferRecord } from './types';

/**
 * Pure selection + ordering for the My Transfers list.
 *
 * Keeps only the transfers where `account` is the sender or the recipient
 * (compared case-insensitively, since addresses are checksummed on chain) and
 * sorts newest first — transfer ids are monotonically increasing, so the
 * highest id is the newest.
 *
 * Does not mutate the input array.
 */
export function selectUserTransfers(
  transfers: TransferRecord[],
  account: string
): TransferRecord[] {
  const target = account.trim().toLowerCase();
  if (!target) return [];

  return transfers
    .filter(
      (t) =>
        t.sender.toLowerCase() === target || t.recipient.toLowerCase() === target
    )
    .sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
}
