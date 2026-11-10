import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import type { Address, Hex } from 'viem';
import { safeRevertVaultAbi, erc20Abi } from '../lib/abi';
import { VAULT_ADDRESS, IS_VAULT_CONFIGURED } from '../lib/config';
import {
  TransferState,
  type TransferRecord,
  NATIVE_TOKEN_ADDRESS,
} from '../lib/types';
import { selectUserTransfers } from '../lib/transferFilter';

type Client = NonNullable<ReturnType<typeof usePublicClient>>;

/** How many of the newest transfer ids are inspected per refresh. */
const ID_WINDOW = 200n;
/** Batch size for `publicClient.multicall` (chain must have Multicall3). */
const MULTICALL_BATCH_SIZE = 50;
/** Batch size for the plain `readContract` fallback. */
const READ_BATCH_SIZE = 20;
/** Refresh cadence while the tab is visible. */
const REFRESH_INTERVAL_MS = 15_000;

type ReadResult =
  | { status: 'success'; result: unknown }
  | { status: 'failure'; error: unknown };

/** Shape returned by the vault's `getTransfer(id)`. */
type OnChainTransfer = {
  sender: Address;
  recipient: Address;
  token: Address;
  amount: bigint;
  unlockTime: bigint;
  expiry: bigint;
  secretHash: Hex;
  state: bigint | number;
};

/**
 * Reads a list of view-function calls in batches.
 *
 * Uses `publicClient.multicall({ allowFailure: true })` in batches of 50 when
 * the chain config exposes a Multicall3 contract; otherwise (or if the call is
 * rejected) falls back to `Promise.all` of `readContract` in batches of 20.
 * Free-tier RPCs that cap `eth_getLogs` to a few blocks are irrelevant here —
 * these are plain `eth_call`s, so no log range limits apply.
 */
async function readInBatches(client: Client, calls: readonly unknown[]): Promise<ReadResult[]> {
  const results: ReadResult[] = [];

  const multicallFn = client.multicall as unknown as (args: unknown) => Promise<ReadResult[]>;
  const readFn = client.readContract as unknown as (args: unknown) => Promise<unknown>;

  let useMulticall = Boolean(client.chain?.contracts?.multicall3?.address);

  for (let i = 0; i < calls.length; i += MULTICALL_BATCH_SIZE) {
    const batch = calls.slice(i, i + MULTICALL_BATCH_SIZE);

    if (useMulticall) {
      try {
        const res = await multicallFn({ contracts: batch, allowFailure: true });
        results.push(...res);
        continue;
      } catch {
        // Multicall3 unavailable or rejected by the RPC — switch to plain reads.
        useMulticall = false;
      }
    }

    for (let j = 0; j < batch.length; j += READ_BATCH_SIZE) {
      const slice = batch.slice(j, j + READ_BATCH_SIZE);
      const settled = await Promise.all(
        slice.map(async (call) => {
          try {
            const result = await readFn(call);
            return { status: 'success' as const, result };
          } catch (error) {
            return { status: 'failure' as const, error };
          }
        })
      );
      results.push(...settled);
    }
  }

  return results;
}

/**
 * Loads the newest `ID_WINDOW` transfers from the vault with direct contract
 * reads (`nextId()` + `getTransfer(id)`), keeps the ones involving `user`,
 * newest first, and enriches ERC-20 entries with symbol/decimals.
 */
async function fetchTransfersForUser(client: Client, user: Address): Promise<TransferRecord[]> {
  const nextId = (await client.readContract({
    address: VAULT_ADDRESS,
    abi: safeRevertVaultAbi,
    functionName: 'nextId',
  })) as bigint;

  if (nextId <= 0n) return [];

  const startId = nextId > ID_WINDOW ? nextId - ID_WINDOW : 0n;
  const ids: bigint[] = [];
  for (let id = startId; id < nextId; id++) ids.push(id);

  const calls = ids.map((id) => ({
    address: VAULT_ADDRESS,
    abi: safeRevertVaultAbi,
    functionName: 'getTransfer' as const,
    args: [id] as const,
  }));

  const results = await readInBatches(client, calls);

  const records: TransferRecord[] = [];
  results.forEach((res, index) => {
    if (res.status !== 'success' || !res.result) return;
    const t = res.result as OnChainTransfer;
    records.push({
      id: ids[index],
      sender: t.sender,
      recipient: t.recipient,
      token: t.token,
      amount: t.amount,
      unlockTime: BigInt(t.unlockTime),
      expiry: BigInt(t.expiry),
      secretHash: t.secretHash,
      state: Number(t.state) as TransferState,
    });
  });

  // Keep only transfers involving the connected account, newest first.
  const mine = selectUserTransfers(records, user);
  if (mine.length === 0) return [];

  // Enrich ERC-20 entries with symbol/decimals (one batched read per token).
  const tokenAddresses = new Set<Address>();
  for (const item of mine) {
    if (item.token.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
      tokenAddresses.add(item.token);
    }
  }

  const tokenMetaMap = new Map<string, { symbol: string; decimals: number }>();
  if (tokenAddresses.size > 0) {
    const tokenCalls = Array.from(tokenAddresses).flatMap((tokenAddr) => [
      { address: tokenAddr, abi: erc20Abi, functionName: 'symbol' as const },
      { address: tokenAddr, abi: erc20Abi, functionName: 'decimals' as const },
    ]);

    const tokenResults = await readInBatches(client, tokenCalls);

    let i = 0;
    for (const tokenAddr of tokenAddresses) {
      const symbolRes = tokenResults[i++];
      const decimalsRes = tokenResults[i++];
      const sym =
        symbolRes?.status === 'success' && typeof symbolRes.result === 'string'
          ? symbolRes.result
          : 'TOKEN';
      const dec =
        decimalsRes?.status === 'success' && decimalsRes.result !== undefined
          ? Number(decimalsRes.result)
          : 18;
      tokenMetaMap.set(tokenAddr.toLowerCase(), { symbol: sym, decimals: dec });
    }
  }

  return mine.map((item) => {
    if (item.token.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
      return { ...item, tokenSymbol: 'ETH', tokenDecimals: 18 };
    }
    const meta = tokenMetaMap.get(item.token.toLowerCase());
    return {
      ...item,
      tokenSymbol: meta?.symbol || 'ERC-20',
      tokenDecimals: meta?.decimals ?? 18,
    };
  });
}

export function useTransfers() {
  const { address: userAddress, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const enabled = Boolean(
    publicClient && userAddress && isConnected && IS_VAULT_CONFIGURED
  );

  const { data, isLoading, error, refetch } = useQuery<TransferRecord[]>({
    queryKey: ['transfers', VAULT_ADDRESS, userAddress ?? ''],
    queryFn: () => {
      if (!publicClient || !userAddress) {
        throw new Error('Wallet not connected');
      }
      return fetchTransfersForUser(publicClient, userAddress);
    },
    enabled,
    // Refresh every 15s, but only while the tab is visible.
    refetchInterval: () =>
      typeof document !== 'undefined' && document.hidden ? false : REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: 1,
  });

  return {
    transfers: data ?? [],
    isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch,
  };
}
