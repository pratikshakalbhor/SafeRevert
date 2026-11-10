import React, { useState, useEffect, useMemo } from 'react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { formatUnits } from 'viem';
import {
  KeyRound,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  Eye,
  EyeOff,
  ClipboardPaste,
} from 'lucide-react';
import { safeRevertVaultAbi, erc20Abi } from '../lib/abi';
import { VAULT_ADDRESS, TARGET_CHAIN } from '../lib/config';
import {
  TransferState,
  STATE_LABELS,
  NATIVE_TOKEN_ADDRESS,
  type TransferRecord,
} from '../lib/types';
import { useToast } from '../hooks/useToast';
import { decodeContractError } from '../lib/errors';
import {
  isSecretValid,
  ZERO_SECRET_HASH,
  normalizeSecret,
} from '../lib/crypto';
import {
  formatLocalTimestamp,
  getCountdown,
} from '../lib/time';

interface ClaimPageProps {
  initialTransferId?: bigint | null;
}

export const ClaimPage: React.FC<ClaimPageProps> = ({ initialTransferId }) => {
  const { address: userAddress, isConnected } = useAccount();
  const { addToast } = useToast();

  const [idInput, setIdInput] = useState<string>(
    initialTransferId !== undefined && initialTransferId !== null ? initialTransferId.toString() : ''
  );
  const [activeId, setActiveId] = useState<bigint | null>(
    initialTransferId !== undefined && initialTransferId !== null ? initialTransferId : null
  );
  const [prevInitialId, setPrevInitialId] = useState(initialTransferId);

  if (initialTransferId !== prevInitialId) {
    setPrevInitialId(initialTransferId);
    setIdInput(initialTransferId !== undefined && initialTransferId !== null ? initialTransferId.toString() : '');
    setActiveId(initialTransferId !== undefined && initialTransferId !== null ? initialTransferId : null);
  }

  // Secret is kept strictly in component state memory - NEVER in storage or URL
  const [secretInput, setSecretInput] = useState<string>('');
  const [showSecret, setShowSecret] = useState(false);

  // Live timer for live countdown
  const [currentTimestamp, setCurrentTimestamp] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTimestamp(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Read transfer on-chain
  const {
    data: transferRaw,
    isLoading: isReadingTransfer,
    error: readError,
    refetch: refetchTransfer,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: safeRevertVaultAbi,
    functionName: 'getTransfer',
    args: activeId !== null ? [activeId] : undefined,
    query: {
      enabled: activeId !== null,
    },
  });

  // Token metadata read if ERC-20
  const isErc20 =
    transferRaw &&
    transferRaw.token.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase();

  const { data: tokenSymbolData } = useReadContract({
    address: isErc20 ? transferRaw.token : undefined,
    abi: erc20Abi,
    functionName: 'symbol',
    query: { enabled: Boolean(isErc20) },
  });

  const { data: tokenDecimalsData } = useReadContract({
    address: isErc20 ? transferRaw.token : undefined,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: Boolean(isErc20) },
  });

  const tokenSymbol = isErc20 ? (tokenSymbolData as string) || 'ERC-20' : 'ETH';
  const tokenDecimals = isErc20 ? Number(tokenDecimalsData ?? 18) : 18;

  // Parsed transfer record
  const transfer: TransferRecord | null = useMemo(() => {
    if (!transferRaw || activeId === null) return null;
    return {
      id: activeId,
      sender: transferRaw.sender,
      recipient: transferRaw.recipient,
      token: transferRaw.token,
      amount: transferRaw.amount,
      unlockTime: BigInt(transferRaw.unlockTime),
      expiry: BigInt(transferRaw.expiry),
      secretHash: transferRaw.secretHash,
      state: Number(transferRaw.state) as TransferState,
      tokenSymbol,
      tokenDecimals,
    };
  }, [transferRaw, activeId, tokenSymbol, tokenDecimals]);

  // Timing status
  const unlockTs = transfer ? Number(transfer.unlockTime) : 0;
  const expiryTs = transfer ? Number(transfer.expiry) : 0;

  const isBeforeUnlock = transfer ? currentTimestamp < unlockTs : false;
  const isInClaimWindow = transfer ? currentTimestamp >= unlockTs && currentTimestamp < expiryTs : false;
  const isAfterExpiry = transfer ? currentTimestamp >= expiryTs : false;

  const unlockCountdown = getCountdown(unlockTs, currentTimestamp);
  const expiryCountdown = getCountdown(expiryTs, currentTimestamp);

  // Recipient check
  const isRecipientConnected =
    userAddress && transfer
      ? userAddress.toLowerCase() === transfer.recipient.toLowerCase()
      : false;

  // Secret Pre-check
  const isNoSecretRequired = transfer ? transfer.secretHash === ZERO_SECRET_HASH : false;

  const secretMatches = useMemo(() => {
    if (!transfer) return false;
    if (isNoSecretRequired) return true;
    if (!secretInput.trim()) return false;
    return isSecretValid(secretInput, transfer.secretHash);
  }, [transfer, isNoSecretRequired, secretInput]);

  // Can claim check
  const canClaim =
    isConnected &&
    isRecipientConnected &&
    transfer?.state === TransferState.Pending &&
    isInClaimWindow &&
    (isNoSecretRequired || secretMatches);

  // Wagmi Write Contract for Claim
  const {
    writeContract: executeClaim,
    data: claimTxHash,
    isPending: isClaimPending,
    error: claimError,
  } = useWriteContract();

  const {
    isLoading: isClaimWaiting,
    isSuccess: isClaimSuccess,
  } = useWaitForTransactionReceipt({
    hash: claimTxHash,
  });

  useEffect(() => {
    if (isClaimSuccess) {
      addToast({
        type: 'success',
        title: 'Transfer Claimed Successfully!',
        message: 'Funds have been paid out to your recipient wallet.',
        txHash: claimTxHash,
      });
      // Clear secret input immediately
      setSecretInput('');
      refetchTransfer();
    }
  }, [isClaimSuccess, claimTxHash, addToast, refetchTransfer]);

  useEffect(() => {
    if (claimError) {
      addToast({
        type: 'error',
        title: 'Claim Failed',
        message: decodeContractError(claimError),
      });
    }
  }, [claimError, addToast]);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(idInput.trim(), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setActiveId(BigInt(parsed));
    }
  };

  const handleClaimSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canClaim || activeId === null) return;

    // If no secret required, pass empty string per contract spec
    const finalSecret = isNoSecretRequired ? '' : normalizeSecret(secretInput);

    executeClaim({
      address: VAULT_ADDRESS,
      abi: safeRevertVaultAbi,
      functionName: 'claim',
      args: [activeId, finalSecret],
      chainId: TARGET_CHAIN.id,
    });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Title */}
      <div className="text-center">
        <h1 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">
          Claim Escrow Transfer
        </h1>
        <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
          Claim time-locked funds sent to your address. Provide your transfer ID and claim secret.
        </p>
      </div>

      {/* Transfer Lookup Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
        <form onSubmit={handleLookup} className="space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
            Transfer Identifier
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-2.5 text-slate-500 font-mono text-sm">#</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 0, 1, 2..."
                value={idInput}
                onChange={(e) => setIdInput(e.target.value)}
                className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 transition"
              />
            </div>
            <button
              type="submit"
              disabled={!idInput.trim()}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition disabled:opacity-40"
            >
              <Search className="w-3.5 h-3.5" />
              Lookup
            </button>
          </div>
        </form>
      </div>

      {/* Loading state for lookup */}
      {isReadingTransfer && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
          Reading transfer data from Sepolia...
        </div>
      )}

      {/* Not Found State */}
      {!isReadingTransfer && readError && activeId !== null && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
          <XCircle className="w-8 h-8 text-rose-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-200">Transfer #{activeId.toString()} Not Found</h3>
          <p className="text-xs text-slate-400">
            This transfer ID does not exist in the vault contract on Sepolia.
          </p>
        </div>
      )}

      {/* Transfer Information & Claim Form */}
      {transfer && !isReadingTransfer && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
          {/* Header & Status */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs text-slate-400">Transfer Identifier</span>
              <h2 className="text-xl font-mono font-bold text-white">
                #{transfer.id.toString()}
              </h2>
            </div>

            {/* Lifecycle badge */}
            <div>
              {transfer.state === TransferState.Pending && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  Pending
                </span>
              )}
              {transfer.state === TransferState.Claimed && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <CheckCircle2 className="w-4 h-4" /> Claimed
                </span>
              )}
              {transfer.state === TransferState.Cancelled && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                  Cancelled
                </span>
              )}
              {transfer.state === TransferState.Refunded && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
                  Refunded
                </span>
              )}
            </div>
          </div>

          {/* Details Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-slate-400 uppercase text-[10px] font-semibold">Amount to Claim</span>
              <p className="text-xl font-extrabold text-emerald-400 mt-0.5">
                {formatUnits(transfer.amount, transfer.tokenDecimals ?? 18)}{' '}
                <span className="text-sm font-semibold text-white">
                  {transfer.tokenSymbol}
                </span>
              </p>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-slate-400 uppercase text-[10px] font-semibold">Sender (Funder)</span>
              <p className="font-mono text-slate-300 mt-1 truncate" title={transfer.sender}>
                {transfer.sender}
              </p>
            </div>
          </div>

          {/* Recipient Check Banner */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-xs space-y-1">
            <span className="text-slate-400 uppercase text-[10px] font-semibold">Designated Recipient</span>
            <p className="font-mono text-slate-200 truncate" title={transfer.recipient}>
              {transfer.recipient}
            </p>
            {isConnected && (
              <div className="pt-1.5 flex items-center gap-1.5">
                {isRecipientConnected ? (
                  <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Connected wallet matches recipient
                  </span>
                ) : (
                  <span className="text-rose-400 flex items-center gap-1 font-semibold">
                    <XCircle className="w-3.5 h-3.5" /> Connected wallet is NOT the recipient
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Time Window Status */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs space-y-3">
            <div className="flex items-center gap-1.5 font-semibold text-slate-300">
              <Clock className="w-4 h-4 text-indigo-400" />
              <span>Claim Window Schedule</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-800/80">
              <div>
                <span className="text-slate-400">Unlock Time (Claim opens):</span>
                <p className="font-mono text-slate-200 mt-0.5">{formatLocalTimestamp(unlockTs)}</p>
                {isBeforeUnlock && (
                  <p className="text-indigo-400 font-semibold mt-1">
                    🔒 Locked (opens in {unlockCountdown.formatted})
                  </p>
                )}
              </div>

              <div>
                <span className="text-slate-400">Expiry Time (Refund opens):</span>
                <p className="font-mono text-slate-200 mt-0.5">{formatLocalTimestamp(expiryTs)}</p>
                {isInClaimWindow && (
                  <p className="text-emerald-400 font-semibold mt-1 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    Window OPEN (Expires in {expiryCountdown.formatted})
                  </p>
                )}
                {isAfterExpiry && (
                  <p className="text-rose-400 font-semibold mt-1">
                    🔴 Expired (Window closed)
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Secret Input & Pre-Verification */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                Claim Secret
              </label>
              {isNoSecretRequired && (
                <span className="text-[11px] font-semibold text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  No Secret Required
                </span>
              )}
            </div>

            {isNoSecretRequired ? (
              <p className="text-xs text-slate-400">
                This transfer was created with zero hash check. Any claim call from the recipient wallet will succeed without a secret.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Enter the secret provided to you by the sender. The app verifies the hash in the browser before sending any transaction so you won't waste gas if the secret is wrong.
                </p>

                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    placeholder="Paste the 64-character secret..."
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    className="w-full pl-3 pr-20 py-2 rounded-xl bg-slate-900 border border-slate-700 font-mono text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <div className="absolute right-2 top-1.5 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="p-1 text-slate-400 hover:text-white"
                      title={showSecret ? 'Hide secret' : 'Show secret'}
                    >
                      {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          if (text) setSecretInput(text.trim());
                        } catch {
                          // clipboard read denied
                        }
                      }}
                      className="p-1 text-indigo-400 hover:text-indigo-300"
                      title="Paste from clipboard"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Pre-check status feedback */}
                {secretInput.trim() ? (
                  secretMatches ? (
                    <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 flex items-center gap-2 text-xs text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        <strong>Secret verified!</strong> The hash matches the on-chain commitment.
                      </span>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-500/50 flex items-center gap-2 text-xs text-rose-300">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>
                        <strong>Invalid Secret:</strong> Does not match on-chain hash! Submitting now would revert and waste gas.
                      </span>
                    </div>
                  )
                ) : (
                  <p className="text-[10px] text-slate-500">
                    On-chain commitment: <span className="font-mono">{transfer.secretHash}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Claim Action Button */}
          <div>
            {!isConnected ? (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-center text-xs text-slate-400">
                Please connect your recipient wallet to claim this transfer.
              </div>
            ) : !isRecipientConnected ? (
              <div className="p-3 bg-rose-950/30 border border-rose-800/40 rounded-xl text-center text-xs text-rose-300">
                Switch wallet: Your connected address is not the designated recipient of this transfer.
              </div>
            ) : transfer.state !== TransferState.Pending ? (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-center text-xs text-slate-400">
                This transfer is not pending (currently: {STATE_LABELS[transfer.state]}).
              </div>
            ) : isBeforeUnlock ? (
              <div className="p-3 bg-indigo-950/40 border border-indigo-700/40 rounded-xl text-center text-xs text-indigo-300">
                Claim window opens at {formatLocalTimestamp(unlockTs)} (countdown still active).
              </div>
            ) : isAfterExpiry ? (
              <div className="p-3 bg-rose-950/40 border border-rose-800/40 rounded-xl text-center text-xs text-rose-300">
                Claim window closed at {formatLocalTimestamp(expiryTs)}. Funds can now only be refunded by the sender.
              </div>
            ) : (
              <button
                type="button"
                onClick={handleClaimSubmit}
                disabled={!canClaim || isClaimPending || isClaimWaiting}
                className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                {(isClaimPending || isClaimWaiting) && (
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                )}
                {isClaimPending
                  ? 'Confirm Claim in Wallet...'
                  : isClaimWaiting
                  ? 'Confirming Claim on Sepolia...'
                  : 'Claim & Payout Funds'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
