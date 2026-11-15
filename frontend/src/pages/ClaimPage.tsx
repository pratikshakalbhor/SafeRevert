import React, { useState, useEffect, useMemo, useRef } from 'react';
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

// A small labelled detail cell used in the info grid
const DetailCell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div
    className="p-3.5 rounded-xl text-xs"
    style={{ background: 'rgba(10,15,30,0.5)', border: '1px solid rgba(143,163,199,0.14)' }}
  >
    <span
      className="uppercase text-[10px] font-semibold block mb-0.5"
      style={{ color: 'var(--silver-blue)' }}
    >
      {label}
    </span>
    {children}
  </div>
);

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

  // --- Once-per-transaction guards & latest-value refs -----------------------
  const refetchTransferRef = useRef(refetchTransfer);
  useEffect(() => {
    refetchTransferRef.current = refetchTransfer;
  });
  const handledClaimTxRef = useRef<string | null>(null);
  const handledClaimErrorRef = useRef<unknown>(null);

  useEffect(() => {
    if (!isClaimSuccess || !claimTxHash) return;
    // Exactly once per transaction hash
    if (handledClaimTxRef.current === claimTxHash) return;
    handledClaimTxRef.current = claimTxHash;

    addToast({
      type: 'success',
      title: 'Transfer Claimed Successfully!',
      message: 'Funds have been paid out to your recipient wallet.',
      txHash: claimTxHash,
      key: claimTxHash,
    });
    // Clear secret input immediately
    setSecretInput('');
    refetchTransferRef.current();
  }, [isClaimSuccess, claimTxHash, addToast]);

  useEffect(() => {
    if (!claimError || handledClaimErrorRef.current === claimError) return;
    handledClaimErrorRef.current = claimError;

    addToast({
      type: 'error',
      title: 'Claim Failed',
      message: decodeContractError(claimError),
    });
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
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      {/* Title */}
      <div className="text-center space-y-2">
        <h1
          className="font-serif text-3xl sm:text-4xl font-bold tracking-tight"
          style={{ color: 'rgba(255,255,255,0.92)' }}
        >
          Claim Escrow Transfer
        </h1>
        <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--silver-blue)' }}>
          Claim time-locked funds sent to your address. Provide your transfer ID and claim secret.
        </p>
      </div>

      {/* Transfer Lookup Card */}
      <div className="glass-card p-6">
        <form onSubmit={handleLookup} className="space-y-4">
          <label
            className="block text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'rgba(255,255,255,0.7)' }}
          >
            Transfer Identifier
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span
                className="absolute left-3.5 top-2.5 font-mono text-sm"
                style={{ color: 'rgba(143,163,199,0.4)' }}
              >
                #
              </span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 0, 1, 2..."
                value={idInput}
                onChange={(e) => setIdInput(e.target.value)}
                className="sr-input font-mono pl-8"
              />
            </div>
            <button
              type="submit"
              disabled={!idInput.trim()}
              className="btn-primary px-5 py-2.5 text-xs flex items-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" />
              Lookup
            </button>
          </div>
        </form>
      </div>

      {/* Loading state for lookup */}
      {isReadingTransfer && (
        <div
          className="glass-card p-8 text-center text-xs flex items-center justify-center gap-2"
          style={{ color: 'var(--silver-blue)' }}
        >
          <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--copper)' }} />
          Reading transfer data from Sepolia...
        </div>
      )}

      {/* Not Found State */}
      {!isReadingTransfer && readError && activeId !== null && (
        <div className="glass-card p-8 text-center space-y-2">
          <XCircle className="w-8 h-8 mx-auto" style={{ color: 'var(--copper)' }} />
          <h3 className="text-sm font-serif font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>
            Transfer #{activeId.toString()} Not Found
          </h3>
          <p className="text-xs" style={{ color: 'var(--silver-blue)' }}>
            This transfer ID does not exist in the vault contract on Sepolia.
          </p>
        </div>
      )}

      {/* Transfer Information & Claim Form */}
      {transfer && !isReadingTransfer && (
        <div className="glass-card p-6 space-y-6">
          {/* Header & Status */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 pb-4"
            style={{ borderBottom: '1px solid rgba(143,163,199,0.1)' }}
          >
            <div>
              <span className="text-xs" style={{ color: 'var(--silver-blue)' }}>
                Transfer Identifier
              </span>
              <h2 className="text-xl font-mono font-bold" style={{ color: 'rgba(255,255,255,0.92)' }}>
                #{transfer.id.toString()}
              </h2>
            </div>

            {/* Lifecycle badge */}
            <div>
              {transfer.state === TransferState.Pending && isBeforeUnlock && (
                <span className="badge-pending">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: 'var(--silver-blue)', animation: 'pulse 2s infinite' }}
                  />
                  Pending
                </span>
              )}
              {transfer.state === TransferState.Pending && isInClaimWindow && (
                <span className="badge-claimable">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Claimable
                </span>
              )}
              {transfer.state === TransferState.Claimed && (
                <span className="badge-claimed">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Claimed
                </span>
              )}
              {transfer.state === TransferState.Cancelled && (
                <span className="badge-cancelled">Cancelled</span>
              )}
              {transfer.state === TransferState.Refunded && (
                <span className="badge-refunded">Refunded</span>
              )}
            </div>
          </div>

          {/* Details Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailCell label="Amount to Claim">
              <p
                className="text-xl font-semibold font-tabular mt-0.5"
                style={{ color: 'var(--copper)' }}
              >
                {formatUnits(transfer.amount, transfer.tokenDecimals ?? 18)}{' '}
                <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {transfer.tokenSymbol}
                </span>
              </p>
            </DetailCell>

            <DetailCell label="Sender (Funder)">
              <p
                className="font-mono mt-1 truncate text-xs"
                style={{ color: 'rgba(143,163,199,0.8)' }}
                title={transfer.sender}
              >
                {transfer.sender}
              </p>
            </DetailCell>
          </div>

          {/* Recipient Check Banner */}
          <DetailCell label="Designated Recipient">
            <p
              className="font-mono truncate text-xs mb-1"
              style={{ color: 'rgba(255,255,255,0.85)' }}
              title={transfer.recipient}
            >
              {transfer.recipient}
            </p>
            {isConnected && (
              <div className="pt-1.5 flex items-center gap-1.5">
                {isRecipientConnected ? (
                  <span
                    className="flex items-center gap-1 text-xs font-semibold"
                    style={{ color: 'var(--copper)' }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Connected wallet matches recipient
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1 text-xs font-semibold"
                    style={{ color: 'rgba(232,116,59,0.7)' }}
                  >
                    <XCircle className="w-3.5 h-3.5" /> Connected wallet is NOT the recipient
                  </span>
                )}
              </div>
            )}
          </DetailCell>

          {/* Time Window Status */}
          <div
            className="p-4 rounded-xl text-xs space-y-3"
            style={{ background: 'rgba(10,15,30,0.5)', border: '1px solid rgba(143,163,199,0.14)' }}
          >
            <div
              className="flex items-center gap-1.5 font-semibold"
              style={{ color: 'rgba(255,255,255,0.8)' }}
            >
              <Clock className="w-4 h-4" style={{ color: 'var(--silver-blue)' }} />
              <span>Claim Window Schedule</span>
            </div>

            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1"
              style={{ borderTop: '1px solid rgba(143,163,199,0.08)' }}
            >
              <div>
                <span style={{ color: 'var(--silver-blue)' }}>Unlock Time (Claim opens):</span>
                <p className="font-mono mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {formatLocalTimestamp(unlockTs)}
                </p>
                {isBeforeUnlock && (
                  <p className="font-semibold mt-1" style={{ color: 'var(--silver-blue)' }}>
                    🔒 Locked (opens in {unlockCountdown.formatted})
                  </p>
                )}
              </div>

              <div>
                <span style={{ color: 'var(--silver-blue)' }}>Expiry Time (Refund opens):</span>
                <p className="font-mono mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {formatLocalTimestamp(expiryTs)}
                </p>
                {isInClaimWindow && (
                  <p className="font-semibold mt-1 flex items-center gap-1" style={{ color: 'var(--copper)' }}>
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: 'var(--copper)', animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite' }}
                    />
                    Window OPEN (Expires in {expiryCountdown.formatted})
                  </p>
                )}
                {isAfterExpiry && (
                  <p className="font-semibold mt-1 flex items-center gap-1" style={{ color: 'rgba(232,116,59,0.6)' }}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Expired (Window closed)
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Secret Input & Pre-Verification */}
          <div
            className="p-4 rounded-xl space-y-3"
            style={{ background: 'rgba(10,15,30,0.5)', border: '1px solid rgba(143,163,199,0.14)' }}
          >
            <div className="flex items-center justify-between">
              <label
                className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"
                style={{ color: 'rgba(255,255,255,0.8)' }}
              >
                <KeyRound className="w-3.5 h-3.5" style={{ color: 'var(--silver-blue)' }} />
                Claim Secret
              </label>
              {isNoSecretRequired && (
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded"
                  style={{
                    color: 'var(--silver-blue)',
                    background: 'rgba(143,163,199,0.08)',
                    border: '1px solid rgba(143,163,199,0.16)',
                  }}
                >
                  No Secret Required
                </span>
              )}
            </div>

            {isNoSecretRequired ? (
              <p className="text-xs" style={{ color: 'var(--silver-blue)' }}>
                This transfer was created with zero hash check. Any claim call from the recipient wallet will succeed without a secret.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(143,163,199,0.75)' }}>
                  Enter the secret provided to you by the sender. The app verifies the hash in the browser before sending any transaction so you won't waste gas if the secret is wrong.
                </p>

                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    placeholder="Paste the 64-character secret..."
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    className="sr-input font-mono text-xs pl-3 pr-20"
                  />
                  <div className="absolute right-2 top-1.5 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="p-1 rounded transition-colors"
                      style={{ color: 'rgba(143,163,199,0.5)' }}
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
                      className="p-1 rounded transition-colors"
                      style={{ color: 'var(--copper)' }}
                      title="Paste from clipboard"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Pre-check status feedback */}
                {secretInput.trim() ? (
                  secretMatches ? (
                    <div
                      className="p-2.5 rounded-lg flex items-center gap-2 text-xs"
                      style={{
                        background: 'rgba(232,116,59,0.07)',
                        border: '1px solid rgba(232,116,59,0.25)',
                        color: 'var(--copper)',
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        <strong>Secret verified!</strong> The hash matches the on-chain commitment.
                      </span>
                    </div>
                  ) : (
                    <div className="alert-warning p-2.5 flex items-center gap-2 text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        <strong>Invalid Secret:</strong> Does not match on-chain hash! Submitting now would revert and waste gas.
                      </span>
                    </div>
                  )
                ) : (
                  <p className="text-[10px]" style={{ color: 'rgba(143,163,199,0.4)' }}>
                    On-chain commitment:{' '}
                    <span className="font-mono">{transfer.secretHash}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Claim Action Button */}
          <div>
            {!isConnected ? (
              <div
                className="p-3 rounded-xl text-center text-xs"
                style={{
                  background: 'rgba(10,15,30,0.5)',
                  border: '1px solid rgba(143,163,199,0.14)',
                  color: 'var(--silver-blue)',
                }}
              >
                Please connect your recipient wallet to claim this transfer.
              </div>
            ) : !isRecipientConnected ? (
              <div className="alert-warning p-3 text-center text-xs flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Switch wallet: Your connected address is not the designated recipient of this transfer.
              </div>
            ) : transfer.state !== TransferState.Pending ? (
              <div
                className="p-3 rounded-xl text-center text-xs"
                style={{
                  background: 'rgba(10,15,30,0.5)',
                  border: '1px solid rgba(143,163,199,0.14)',
                  color: 'var(--silver-blue)',
                }}
              >
                This transfer is not pending (currently: {STATE_LABELS[transfer.state]}).
              </div>
            ) : isBeforeUnlock ? (
              <div
                className="p-3 rounded-xl text-center text-xs"
                style={{
                  background: 'rgba(143,163,199,0.05)',
                  border: '1px solid rgba(143,163,199,0.16)',
                  color: 'var(--silver-blue)',
                }}
              >
                Claim window opens at {formatLocalTimestamp(unlockTs)} (countdown still active).
              </div>
            ) : isAfterExpiry ? (
              <div className="alert-warning p-3 text-center text-xs flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Claim window closed at {formatLocalTimestamp(expiryTs)}. Funds can now only be refunded by the sender.
              </div>
            ) : (
              <button
                type="button"
                onClick={handleClaimSubmit}
                disabled={!canClaim || isClaimPending || isClaimWaiting}
                className="btn-primary w-full py-3.5 px-4 text-sm flex items-center justify-center gap-2"
              >
                {(isClaimPending || isClaimWaiting) && (
                  <RefreshCw className="w-4 h-4 animate-spin" />
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
