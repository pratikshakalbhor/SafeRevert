import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { formatUnits } from 'viem';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  Ban,
  RotateCcw,
} from 'lucide-react';
import { safeRevertVaultAbi } from '../lib/abi';
import { VAULT_ADDRESS, TARGET_CHAIN } from '../lib/config';
import { TransferState, STATE_LABELS, NATIVE_TOKEN_ADDRESS } from '../lib/types';
import { useToast } from '../hooks/useToast';
import { useTokenInfo } from '../hooks/useTokenInfo';
import { CopyButton } from '../components/CopyButton';
import { decodeContractError } from '../lib/errors';
import { formatLocalTimestamp, getCountdown } from '../lib/time';

/** Shape returned by the vault's `getTransfer(id)` view. */
interface OnChainTransfer {
  sender: `0x${string}`;
  recipient: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  unlockTime: bigint;
  expiry: bigint;
  secretHash: `0x${string}`;
  state: bigint | number;
}

type StepStatus = 'done' | 'current' | 'upcoming';

const shorten = (value: string, head = 10, tail = 8): string =>
  value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;

const statusDotClass: Record<StepStatus, string> = {
  done: 'bg-copper-500 border-copper-400',
  current: 'bg-copper-500 border-copper-300 animate-pulse',
  upcoming: 'bg-silver-800 border-silver-600',
};

const statusLabelClass: Record<StepStatus, string> = {
  done: 'text-copper-400',
  current: 'text-copper-300',
  upcoming: 'text-silver-500',
};

/**
 * Transfer detail: every stored field, a Created → Unlock → Expiry timeline
 * with the current stage highlighted, the vault's explorer link, a
 * secret-free "copy claim link" and the single action this transfer allows.
 */
export const TransferDetailPage: React.FC = () => {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const { address: userAddress } = useAccount();
  const { addToast } = useToast();

  const validId = Boolean(idParam && /^\d+$/.test(idParam));
  const id = validId ? BigInt(idParam as string) : null;

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: safeRevertVaultAbi,
    functionName: 'getTransfer',
    args: id !== null ? [id] : undefined,
    query: { enabled: id !== null },
  });

  const transfer = (data as OnChainTransfer | undefined) ?? null;
  const { token: tokenMeta } = useTokenInfo(transfer?.token);

  // Live clock for the timeline / action windows.
  const [currentTimestamp, setCurrentTimestamp] = useState(() =>
    Math.floor(Date.now() / 1000)
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTimestamp(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // --- Action (cancel / refund) with once-per-transaction guards -------------
  const {
    writeContract,
    data: actionTxHash,
    isPending: isActionPending,
    error: actionError,
  } = useWriteContract();
  const {
    isLoading: isActionWaiting,
    isSuccess: isActionSuccess,
  } = useWaitForTransactionReceipt({ hash: actionTxHash });

  const handledActionTxRef = useRef<string | null>(null);
  const handledActionErrorRef = useRef<unknown>(null);
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  useEffect(() => {
    if (!isActionSuccess || !actionTxHash) return;
    if (handledActionTxRef.current === actionTxHash) return; // exactly once
    handledActionTxRef.current = actionTxHash;

    addToast({
      type: 'success',
      title: 'Transaction Confirmed',
      message: 'The transfer status has been updated on-chain.',
      txHash: actionTxHash,
      key: actionTxHash,
    });
    refetchRef.current();
  }, [isActionSuccess, actionTxHash, addToast]);

  useEffect(() => {
    if (!actionError || handledActionErrorRef.current === actionError) return;
    handledActionErrorRef.current = actionError;

    addToast({
      type: 'error',
      title: 'Action Failed',
      message: decodeContractError(actionError),
    });
  }, [actionError, addToast]);

  const handleCancel = () => {
    if (id === null) return;
    writeContract({
      address: VAULT_ADDRESS,
      abi: safeRevertVaultAbi,
      functionName: 'cancel',
      args: [id],
      chainId: TARGET_CHAIN.id,
    });
  };

  const handleRefund = () => {
    if (id === null) return;
    writeContract({
      address: VAULT_ADDRESS,
      abi: safeRevertVaultAbi,
      functionName: 'refund',
      args: [id],
      chainId: TARGET_CHAIN.id,
    });
  };

  // --- Copy claim link (link only — never the secret) ------------------------
  const claimLink =
    id !== null && typeof window !== 'undefined'
      ? `${window.location.origin}/claim/${id.toString()}`
      : '';
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(claimLink);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2500);
  };

  // --- Invalid id ------------------------------------------------------------
  if (!validId || id === null) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-copper-500/10 border border-copper-500/30 flex items-center justify-center text-copper-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-silver-100">Invalid transfer id</h1>
        <p className="text-sm text-silver-400">
          Transfer ids are plain numbers — the URL looks like{' '}
          <span className="font-mono text-silver-300">/transfers/7</span>.
        </p>
        <Link
          to="/transfers"
          className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Back to my transfers
        </Link>
      </div>
    );
  }

  // --- Loading / error -------------------------------------------------------
  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-4">
        <div className="h-7 bg-silver-800 rounded w-40 animate-pulse" />
        <div className="h-56 bg-silver-900/60 border border-silver-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !transfer) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-copper-500/10 border border-copper-500/30 flex items-center justify-center text-copper-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-silver-100">Transfer not found</h1>
        <p className="text-sm text-silver-400">
          No transfer #{id.toString()} was returned by the vault. It may belong
          to a different contract, or the RPC is unreachable.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="btn-secondary px-5 py-2.5 text-sm inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
          <Link
            to="/transfers"
            className="btn-primary px-5 py-2.5 text-sm"
          >
            Back to my transfers
          </Link>
        </div>
      </div>
    );
  }

  // --- Derived values --------------------------------------------------------
  const account = userAddress?.toLowerCase() ?? '';
  const isSender = transfer.sender.toLowerCase() === account;
  const isRecipient = transfer.recipient.toLowerCase() === account;
  const state = Number(transfer.state) as TransferState;
  const isPending = state === TransferState.Pending;

  const unlockTs = Number(transfer.unlockTime);
  const expiryTs = Number(transfer.expiry);
  const isBeforeUnlock = currentTimestamp < unlockTs;
  const isInClaimWindow = currentTimestamp >= unlockTs && currentTimestamp < expiryTs;
  const isAfterExpiry = currentTimestamp >= expiryTs;

  const isNative =
    transfer.token.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
  const decimals = tokenMeta?.decimals ?? 18;
  const symbol = tokenMeta?.symbol ?? (isNative ? 'ETH' : 'ERC-20');
  const formattedAmount = formatUnits(transfer.amount, decimals);

  const unlockCountdown = getCountdown(unlockTs, currentTimestamp);
  const expiryCountdown = getCountdown(expiryTs, currentTimestamp);

  // Timeline: Created -> Unlock -> Expiry, current stage highlighted.
  const unlockStatus: StepStatus = !isPending
    ? 'done'
    : isBeforeUnlock
      ? 'current'
      : 'done';
  const expiryStatus: StepStatus = !isPending
    ? 'done'
    : isAfterExpiry
      ? 'current'
      : isBeforeUnlock
        ? 'upcoming'
        : 'current';

  const timeline: Array<{
    key: string;
    label: string;
    detail: string;
    status: StepStatus;
  }> = [
    {
      key: 'created',
      label: 'Created',
      detail: `Locked in vault · #${id.toString()}`,
      status: 'done',
    },
    {
      key: 'unlock',
      label: 'Unlock',
      detail: `${formatLocalTimestamp(unlockTs)} · ${isBeforeUnlock ? unlockCountdown.formatted + ' left' : 'reached'}`,
      status: unlockStatus,
    },
    {
      key: 'expiry',
      label: 'Expiry',
      detail: `${formatLocalTimestamp(expiryTs)} · ${isAfterExpiry ? 'refund open' : expiryCountdown.formatted + ' left'}`,
      status: expiryStatus,
    },
  ];

  const busy = isActionPending || isActionWaiting;

  const actionBlock = () => {
    if (!isPending) {
      return (
        <div className="text-xs text-silver-400 bg-navy px-4 py-3 rounded-xl border border-silver-800 inline-flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-silver-500" />
          Terminal state · {STATE_LABELS[state]}
        </div>
      );
    }
    if (isSender && isBeforeUnlock) {
      return (
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className="btn-destructive px-5 py-3 text-sm inline-flex items-center gap-2"
        >
          {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
          <Ban className="w-4 h-4" /> Cancel &amp; reclaim funds
        </button>
      );
    }
    if (isSender && isAfterExpiry) {
      return (
        <button
          type="button"
          onClick={handleRefund}
          disabled={busy}
          className="btn-primary px-5 py-3 text-sm inline-flex items-center gap-2"
        >
          {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
          <RotateCcw className="w-4 h-4" /> Refund
        </button>
      );
    }
    if (isRecipient && isInClaimWindow) {
      return (
        <button
          type="button"
          onClick={() => navigate(`/claim/${id.toString()}`)}
          className="btn-primary px-5 py-3 text-sm inline-flex items-center gap-2"
        >
          <KeyRound className="w-4 h-4" /> Claim with secret
        </button>
      );
    }
    if (!isSender && !isRecipient) {
      return (
        <div className="text-xs text-silver-500 bg-navy px-4 py-3 rounded-xl border border-silver-800">
          Read-only view — you are not the sender or recipient of this transfer.
        </div>
      );
    }
    return (
      <div className="text-xs text-silver-500 bg-navy px-4 py-3 rounded-xl border border-silver-800">
        {isBeforeUnlock
          ? 'No action available while locked — cancel is sender-only and closes at unlock.'
          : isInClaimWindow
            ? 'Claim window is open for the recipient; cancel and refund are closed.'
            : 'Refund is open for the sender after expiry.'}
      </div>
    );
  };

  const fieldRow = (label: string, value: React.ReactNode, mono = false, copyValue?: string) => (
    <div className="bg-silver-900/50 border border-silver-800 rounded-xl p-3.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-silver-500">
          {label}
        </span>
        {copyValue && (
          <CopyButton
            value={copyValue}
            label={`Copy ${label.toLowerCase()} address`}
          />
        )}
      </div>
      <div
        className={`mt-1 text-sm text-silver-100 break-all ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Link
            to="/transfers"
            className="inline-flex items-center gap-1.5 text-xs text-copper-400 hover:text-copper-300"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> My transfers
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-silver-100 flex items-center gap-3">
            <span className="font-mono text-lg bg-silver-900 px-2.5 py-1 rounded-lg border border-silver-800">
              #{id.toString()}
            </span>
            Transfer detail
          </h1>
        </div>
        <span
          className={
            isPending && isInClaimWindow
              ? 'badge-claimable'
              : state === TransferState.Pending
                ? 'badge-pending'
                : state === TransferState.Claimed
                  ? 'badge-claimed'
                  : state === TransferState.Cancelled
                    ? 'badge-cancelled'
                    : 'badge-refunded'
          }
        >
          {STATE_LABELS[state]}
        </span>
      </div>

      {/* Timeline */}
      <section className="glass-card p-5 sm:p-6">
        <h2 className="text-sm font-bold text-silver-100 flex items-center gap-2 mb-5">
          <Clock className="w-4 h-4 text-copper-400" /> Lifecycle
        </h2>
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {timeline.map((step, index) => (
            <li key={step.key} className="relative min-w-0">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-4 h-4 rounded-full border-2 shrink-0 ${statusDotClass[step.status]}`}
                />
                {index < timeline.length - 1 && (
                  <span
                    className={`hidden sm:block flex-1 h-px ${
                      timeline[index + 1].status === 'upcoming'
                        ? 'bg-silver-800'
                        : 'bg-copper-600/60'
                    }`}
                  />
                )}
              </div>
              <p
                className={`mt-2 text-xs font-bold ${statusLabelClass[step.status]}`}
              >
                {step.label}
                {step.status === 'current' && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide">
                    · now
                  </span>
                )}
              </p>
              <p className="text-[11px] text-silver-500 leading-relaxed break-words">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Fields */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-silver-100">All fields</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {fieldRow('Amount', (
            <>
              <span className="text-base font-semibold text-silver-100 font-tabular">
                {formattedAmount}
              </span>{' '}
              <span className="text-copper-400 font-semibold">{symbol}</span>
            </>
          ))}
          {fieldRow(
            'Token',
            <>
              <span className="block">{isNative ? 'Native ETH' : 'ERC-20'}</span>
              <span className="text-[11px] text-silver-500">{transfer.token}</span>
            </>
          )}
          {fieldRow('Sender', transfer.sender, true, transfer.sender)}
          {fieldRow('Recipient', transfer.recipient, true, transfer.recipient)}
          {fieldRow('Unlock time', formatLocalTimestamp(unlockTs), true)}
          {fieldRow('Expiry', formatLocalTimestamp(expiryTs), true)}
          {fieldRow(
            'Secret commitment',
            <span title={transfer.secretHash}>
              {shorten(transfer.secretHash, 14, 10)}
            </span>,
            true
          )}
          {fieldRow('State', STATE_LABELS[state])}
          {fieldRow(
            'Your role',
            isSender ? 'Sender' : isRecipient ? 'Recipient' : 'Viewer'
          )}
        </div>
        <p className="text-[11px] text-silver-500">
          Only the hash of the secret is stored on-chain — the secret itself
          never appears in a URL or in this contract.
        </p>
      </section>

      {/* Links + actions */}
      <section className="glass-card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`https://sepolia.etherscan.io/address/${VAULT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary inline-flex items-center gap-1.5 px-4 py-2.5 text-xs"
          >
            <ShieldCheck className="w-4 h-4 text-copper-400" /> Vault on
            Etherscan
            <ExternalLink className="w-3.5 h-3.5 text-silver-500" />
          </a>

          <button
            type="button"
            onClick={handleCopyLink}
            disabled={!claimLink}
            className="btn-secondary inline-flex items-center gap-1.5 px-4 py-2.5 text-xs"
          >
            <Link2 className="w-4 h-4" />
            {copyState === 'copied' ? 'Copied!' : 'Copy claim link'}
          </button>
        </div>

        {copyState === 'failed' && (
          <p className="text-[11px] text-copper-400 break-all">
            Clipboard access was blocked — copy manually: {claimLink}
          </p>
        )}
        <p className="text-[11px] text-silver-500">
          The claim link only contains the transfer id. It never contains the
          secret — the recipient enters that on the claim page.
        </p>

        <div className="pt-4 border-t border-silver-800/80 flex flex-wrap items-center gap-3">
          {actionBlock()}
        </div>
      </section>
    </div>
  );
};
