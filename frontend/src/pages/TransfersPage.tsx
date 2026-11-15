import React, { useState, useEffect, useRef } from 'react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { formatUnits } from 'viem';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  RotateCcw,
  Ban,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { safeRevertVaultAbi } from '../lib/abi';
import { VAULT_ADDRESS, TARGET_CHAIN } from '../lib/config';
import {
  TransferState,
  STATE_LABELS,
} from '../lib/types';
import { useTransfers } from '../hooks/useTransfers';
import { useToast } from '../hooks/useToast';
import { CopyButton } from '../components/CopyButton';
import { decodeContractError } from '../lib/errors';
import {
  formatLocalTimestamp,
  getCountdown,
} from '../lib/time';
import {
  listContainerVariants,
  listContainerVariantsReduced,
  listItemVariants,
  listItemVariantsReduced,
  badgeVariants,
  badgeVariantsReduced,
  checkmarkVariants,
  checkmarkVariantsReduced,
  pickVariants,
} from '../lib/motion';

interface TransfersPageProps {
  onNavigateToClaim: (id: bigint) => void;
}

export const TransfersPage: React.FC<TransfersPageProps> = ({
  onNavigateToClaim,
}) => {
  const { address: userAddress, isConnected } = useAccount();
  const { transfers, isLoading, error, refetch } = useTransfers();
  const { addToast } = useToast();
  const reduced = useReducedMotion() ?? false;

  const containerVariants = pickVariants(
    reduced,
    listContainerVariants,
    listContainerVariantsReduced
  );
  const itemVariants = pickVariants(
    reduced,
    listItemVariants,
    listItemVariantsReduced
  );
  const statusBadgeVariants = pickVariants(
    reduced,
    badgeVariants,
    badgeVariantsReduced
  );
  const ckVariants = pickVariants(
    reduced,
    checkmarkVariants,
    checkmarkVariantsReduced
  );

  const [activeFilter, setActiveFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [currentTimestamp, setCurrentTimestamp] = useState(() => Math.floor(Date.now() / 1000));
  // Track which transfer IDs just had a successful action (for checkmark animation)
  const [successIds, setSuccessIds] = useState<Set<string>>(new Set());

  // Update live clock every second for live countdowns
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTimestamp(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Wagmi Write Contract for Cancel and Refund
  const {
    writeContract: executeAction,
    data: actionTxHash,
    isPending: isActionPending,
    error: actionError,
    variables: actionVariables,
  } = useWriteContract();

  const {
    isLoading: isActionWaiting,
    isSuccess: isActionSuccess,
  } = useWaitForTransactionReceipt({
    hash: actionTxHash,
  });

  // --- Once-per-transaction guards & latest-value refs -----------------------
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  const handledActionTxRef = useRef<string | null>(null);
  const handledActionErrorRef = useRef<unknown>(null);

  useEffect(() => {
    if (!isActionSuccess || !actionTxHash) return;
    // Exactly once per transaction hash
    if (handledActionTxRef.current === actionTxHash) return;
    handledActionTxRef.current = actionTxHash;

    addToast({
      type: 'success',
      title: 'Transaction Confirmed',
      message: 'The transfer status has been updated on-chain.',
      txHash: actionTxHash,
      key: actionTxHash,
    });
    // Show checkmark for the affected transfer
    if (actionVariables?.args?.[0] !== undefined) {
      const idStr = String(actionVariables.args[0]);
      setSuccessIds((prev) => new Set([...prev, idStr]));
      setTimeout(() => {
        setSuccessIds((prev) => {
          const next = new Set(prev);
          next.delete(idStr);
          return next;
        });
      }, 2500);
    }
    refetchRef.current();
  }, [isActionSuccess, actionTxHash, actionVariables, addToast]);

  useEffect(() => {
    if (!actionError || handledActionErrorRef.current === actionError) return;
    handledActionErrorRef.current = actionError;

    addToast({
      type: 'error',
      title: 'Action Failed',
      message: decodeContractError(actionError),
    });
  }, [actionError, addToast]);

  const handleCancel = (id: bigint) => {
    executeAction({
      address: VAULT_ADDRESS,
      abi: safeRevertVaultAbi,
      functionName: 'cancel',
      args: [id],
      chainId: TARGET_CHAIN.id,
    });
  };

  const handleRefund = (id: bigint) => {
    executeAction({
      address: VAULT_ADDRESS,
      abi: safeRevertVaultAbi,
      functionName: 'refund',
      args: [id],
      chainId: TARGET_CHAIN.id,
    });
  };

  // Filter transfers
  const filteredTransfers = transfers.filter((t) => {
    if (!userAddress) return false;
    const isSender = t.sender.toLowerCase() === userAddress.toLowerCase();
    const isRecipient = t.recipient.toLowerCase() === userAddress.toLowerCase();

    if (activeFilter === 'sent') return isSender;
    if (activeFilter === 'received') return isRecipient;
    return isSender || isRecipient;
  });

  const filterBtnStyle = (active: boolean) =>
    active
      ? { color: 'var(--copper)', background: 'rgba(232,116,59,0.1)', border: '1px solid rgba(232,116,59,0.28)' }
      : { color: 'rgba(143,163,199,0.65)', background: 'transparent', border: '1px solid transparent' };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1
            className="font-serif text-3xl sm:text-4xl font-bold tracking-tight"
            style={{ color: 'rgba(255,255,255,0.92)' }}
          >
            My Transfers
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--silver-blue)' }}>
            Track outgoing and incoming time-locked escrows. Reverse or refund when allowed.
          </p>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="btn-secondary self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div
        className="flex items-center gap-2 mb-6 pb-3"
        style={{ borderBottom: '1px solid rgba(143,163,199,0.1)' }}
      >
        {(['all', 'sent', 'received'] as const).map((f) => {
          const labels = {
            all: `All Transfers (${transfers.length})`,
            sent: 'Sent (Outgoing)',
            received: 'Received (Incoming)',
          };
          return (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-200"
              style={filterBtnStyle(activeFilter === f)}
            >
              {labels[f]}
            </button>
          );
        })}
      </div>

      {/* Wallet Not Connected State */}
      {!isConnected && (
        <div className="glass-card p-10 text-center space-y-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto"
            style={{ background: 'rgba(232,116,59,0.08)', border: '1px solid rgba(232,116,59,0.2)' }}
          >
            <ShieldCheck className="w-6 h-6" style={{ color: 'var(--copper)' }} />
          </div>
          <h3 className="text-base font-serif font-bold" style={{ color: 'rgba(255,255,255,0.92)' }}>
            Connect Wallet
          </h3>
          <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--silver-blue)' }}>
            Please connect your wallet to view your sent and received SafeRevert escrow transfers.
          </p>
        </div>
      )}

      {/* Loading Skeleton */}
      {isConnected && isLoading && transfers.length === 0 && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="glass-card p-5 animate-pulse space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="h-5 rounded w-1/4" style={{ background: 'rgba(143,163,199,0.1)' }} />
                <div className="h-5 rounded w-16" style={{ background: 'rgba(143,163,199,0.1)' }} />
              </div>
              <div className="h-4 rounded w-1/2" style={{ background: 'rgba(143,163,199,0.07)' }} />
              <div className="h-8 rounded w-full" style={{ background: 'rgba(143,163,199,0.05)' }} />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {isConnected && error && transfers.length === 0 && (
        <div className="glass-card p-6 text-center space-y-2 alert-warning">
          <AlertTriangle className="w-8 h-8 mx-auto" style={{ color: 'var(--copper)' }} />
          <h4 className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>
            Unable to load transfers
          </h4>
          <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--copper)' }}>
            {error}
          </p>
          <button
            onClick={() => refetch()}
            className="btn-destructive mt-3 px-4 py-1.5 text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {isConnected && !isLoading && filteredTransfers.length === 0 && (
        <div className="glass-card p-12 text-center space-y-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto"
            style={{ background: 'rgba(143,163,199,0.07)', border: '1px solid rgba(143,163,199,0.14)' }}
          >
            <Clock className="w-6 h-6" style={{ color: 'var(--silver-blue)' }} />
          </div>
          <h3 className="text-base font-serif font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>
            No Transfers Found
          </h3>
          <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--silver-blue)' }}>
            {activeFilter === 'sent'
              ? 'You have not sent any transfers yet.'
              : activeFilter === 'received'
              ? 'You have no incoming transfers locked for your address.'
              : 'No transfers found for your connected wallet.'}
          </p>
        </div>
      )}

      {/* Transfers List — staggered entrance */}
      {isConnected && filteredTransfers.length > 0 && (
        <motion.div
          className="space-y-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence initial={false}>
            {filteredTransfers.map((item) => {
              const isSender = userAddress && item.sender.toLowerCase() === userAddress.toLowerCase();
              const isRecipient = userAddress && item.recipient.toLowerCase() === userAddress.toLowerCase();

              const unlockTs = Number(item.unlockTime);
              const expiryTs = Number(item.expiry);

              // Phase checks
              const isBeforeUnlock = currentTimestamp < unlockTs;
              const isInClaimWindow = currentTimestamp >= unlockTs && currentTimestamp < expiryTs;
              const isAfterExpiry = currentTimestamp >= expiryTs;

              const unlockCountdown = getCountdown(unlockTs, currentTimestamp);
              const expiryCountdown = getCountdown(expiryTs, currentTimestamp);

              const isPending = item.state === TransferState.Pending;
              const isCancelled = item.state === TransferState.Cancelled;
              const isClaimed = item.state === TransferState.Claimed;
              const isRefunded = item.state === TransferState.Refunded;

              const decimals = item.tokenDecimals ?? 18;
              const formattedAmount = formatUnits(item.amount, decimals);
              const idStr = item.id.toString();
              const justSucceeded = successIds.has(idStr);

              // Countdown pulse: only when under 60s, only when motion is not reduced
              const unlockSecsLeft = unlockTs - currentTimestamp;
              const expirySecsLeft = expiryTs - currentTimestamp;
              const shouldPulseUnlock = !reduced && isPending && isBeforeUnlock && unlockSecsLeft > 0 && unlockSecsLeft <= 60;
              const shouldPulseExpiry = !reduced && isPending && isInClaimWindow && expirySecsLeft > 0 && expirySecsLeft <= 60;

              return (
                <motion.div
                  key={idStr}
                  variants={itemVariants}
                  layout
                  className="glass-card p-5 space-y-4 transition-all duration-200"
                  style={{ '--hover-border': 'rgba(143,163,199,0.28)' } as React.CSSProperties}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(143,163,199,0.28)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(143,163,199,0.16)';
                  }}
                >
                  {/* Top Row: ID, Direction, Status Badge */}
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 pb-3"
                    style={{ borderBottom: '1px solid rgba(143,163,199,0.1)' }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="font-mono text-sm font-bold px-2.5 py-1 rounded-lg"
                        style={{
                          color: 'rgba(255,255,255,0.92)',
                          background: 'rgba(10,15,30,0.6)',
                          border: '1px solid rgba(143,163,199,0.14)',
                        }}
                      >
                        #{idStr}
                      </span>

                      {isSender && (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded"
                          style={{
                            background: 'rgba(143,163,199,0.08)',
                            color: 'var(--silver-blue)',
                            border: '1px solid rgba(143,163,199,0.18)',
                          }}
                        >
                          <ArrowUpRight className="w-3 h-3" /> Sent
                        </span>
                      )}

                      {isRecipient && (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded"
                          style={{
                            background: 'rgba(232,116,59,0.08)',
                            color: 'var(--copper)',
                            border: '1px solid rgba(232,116,59,0.2)',
                          }}
                        >
                          <ArrowDownLeft className="w-3 h-3" /> Received
                        </span>
                      )}
                    </div>

                    {/* Animated status badge + success checkmark */}
                    <div className="flex items-center gap-2">
                      {/* Success checkmark overlay after action */}
                      <AnimatePresence>
                        {justSucceeded && (
                          <motion.span
                            variants={ckVariants}
                            initial="hidden"
                            animate="visible"
                            exit={{ opacity: 0, transition: { duration: 0.15 } }}
                            className="inline-flex items-center gap-1 text-xs font-semibold"
                            style={{ color: 'var(--copper)' }}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Done!
                          </motion.span>
                        )}
                      </AnimatePresence>

                      {/* Lifecycle State Badge — cross-fades on key change */}
                      <AnimatePresence mode="wait">
                        {isPending && isBeforeUnlock && (
                          <motion.span
                            key="pending"
                            variants={statusBadgeVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="badge-pending"
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: 'var(--silver-blue)', animation: 'pulse 2s infinite' }}
                            />
                            Pending
                          </motion.span>
                        )}
                        {isPending && isInClaimWindow && (
                          <motion.span
                            key="claimable"
                            variants={statusBadgeVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="badge-claimable"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                            Claimable
                          </motion.span>
                        )}
                        {isPending && isAfterExpiry && (
                          <motion.span
                            key="expired"
                            variants={statusBadgeVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="badge-cancelled"
                          >
                            Expired
                          </motion.span>
                        )}
                        {isClaimed && (
                          <motion.span
                            key="claimed"
                            variants={statusBadgeVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="badge-claimed"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Claimed
                          </motion.span>
                        )}
                        {isCancelled && (
                          <motion.span
                            key="cancelled"
                            variants={statusBadgeVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="badge-cancelled"
                          >
                            <Ban className="w-3.5 h-3.5" /> Cancelled
                          </motion.span>
                        )}
                        {isRefunded && (
                          <motion.span
                            key="refunded"
                            variants={statusBadgeVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="badge-refunded"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Refunded
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    {/* Amount & Asset */}
                    <div>
                      <span
                        className="uppercase text-[10px] font-semibold"
                        style={{ color: 'var(--silver-blue)' }}
                      >
                        Amount
                      </span>
                      <p
                        className="text-base font-bold mt-0.5 font-tabular"
                        style={{ color: 'rgba(255,255,255,0.92)' }}
                      >
                        {formattedAmount}{' '}
                        <span className="text-sm font-semibold" style={{ color: 'var(--copper)' }}>
                          {item.tokenSymbol || 'ETH'}
                        </span>
                      </p>
                    </div>

                    {/* Counterparty Address */}
                    <div>
                      <span
                        className="uppercase text-[10px] font-semibold"
                        style={{ color: 'var(--silver-blue)' }}
                      >
                        {isSender ? 'Recipient' : 'Sender'}
                      </span>
                      <div className="mt-0.5 flex items-center gap-2 min-w-0">
                        <p
                          className="font-mono truncate text-xs flex-1 min-w-0"
                          style={{ color: 'rgba(143,163,199,0.8)' }}
                          title={isSender ? item.recipient : item.sender}
                        >
                          {isSender ? item.recipient : item.sender}
                        </p>
                        <CopyButton
                          value={isSender ? item.recipient : item.sender}
                          label={
                            isSender
                              ? 'Copy recipient address'
                              : 'Copy sender address'
                          }
                          className="shrink-0"
                        />
                      </div>
                    </div>

                    {/* Live Status / Timing */}
                    <div>
                      <span
                        className="uppercase text-[10px] font-semibold"
                        style={{ color: 'var(--silver-blue)' }}
                      >
                        Live Timing
                      </span>
                      <div className="mt-0.5">
                        {isPending ? (
                          isBeforeUnlock ? (
                            <div
                              className={`font-semibold flex items-center gap-1 text-xs ${
                                shouldPulseUnlock ? 'animate-pulse' : ''
                              }`}
                              style={{ color: 'var(--silver-blue)' }}
                            >
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                              Unlocks in: {unlockCountdown.formatted}
                            </div>
                          ) : isInClaimWindow ? (
                            <div
                              className={`font-semibold flex items-center gap-1 text-xs ${
                                shouldPulseExpiry ? 'animate-pulse' : ''
                              }`}
                              style={{ color: 'var(--copper)' }}
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ background: 'var(--copper)', animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite' }}
                              />
                              Open (Expires: {expiryCountdown.formatted})
                            </div>
                          ) : (
                            <div
                              className="font-semibold flex items-center gap-1 text-xs"
                              style={{ color: 'rgba(232,116,59,0.7)' }}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Expired (Refundable)
                            </div>
                          )
                        ) : (
                          <span className="text-xs" style={{ color: 'rgba(143,163,199,0.5)' }}>
                            Terminal state
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Timestamps footer */}
                  <div
                    className="pt-2 flex flex-wrap justify-between gap-2 text-[11px] font-mono"
                    style={{
                      borderTop: '1px solid rgba(143,163,199,0.08)',
                      color: 'rgba(143,163,199,0.5)',
                    }}
                  >
                    <span>Unlock: {formatLocalTimestamp(unlockTs)}</span>
                    <span>Expiry: {formatLocalTimestamp(expiryTs)}</span>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="pt-2 flex flex-wrap items-center justify-end gap-2.5">
                    {/* Full detail (timeline, all fields, claim link) */}
                    <Link
                      to={`/transfers/${item.id.toString()}`}
                      className="px-3.5 py-1.5 text-xs flex items-center gap-1.5 rounded-lg font-semibold transition"
                      style={{
                        color: 'rgba(143,163,199,0.8)',
                        background: 'rgba(143,163,199,0.05)',
                        border: '1px solid rgba(143,163,199,0.16)',
                      }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Details
                    </Link>

                    {/* Sender Actions */}
                    {isSender && isPending && (
                      <>
                        {/* Cancel Button: Allowed only before unlock */}
                        {isBeforeUnlock ? (
                          <button
                            type="button"
                            onClick={() => handleCancel(item.id)}
                            disabled={isActionPending || isActionWaiting}
                            className="btn-destructive px-3.5 py-1.5 text-xs flex items-center gap-1.5"
                          >
                            {(isActionPending || isActionWaiting) && (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            )}
                            <Ban className="w-3.5 h-3.5" />
                            Cancel &amp; Reclaim Funds
                          </button>
                        ) : (
                          <div
                            className="text-[11px] px-3 py-1.5 rounded-lg"
                            style={{
                              color: 'rgba(143,163,199,0.4)',
                              background: 'rgba(10,15,30,0.5)',
                              border: '1px solid rgba(143,163,199,0.1)',
                            }}
                            title="Cancel is only possible before unlock time"
                          >
                            Cancel closed at unlock time
                          </div>
                        )}

                        {/* Refund Button: Allowed only at or after expiry */}
                        {isAfterExpiry ? (
                          <button
                            type="button"
                            onClick={() => handleRefund(item.id)}
                            disabled={isActionPending || isActionWaiting}
                            className="btn-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5"
                          >
                            {(isActionPending || isActionWaiting) && (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            )}
                            Refund
                          </button>
                        ) : (
                          <div
                            className="text-[11px] px-3 py-1.5 rounded-lg"
                            style={{
                              color: 'rgba(143,163,199,0.4)',
                              background: 'rgba(10,15,30,0.5)',
                              border: '1px solid rgba(143,163,199,0.1)',
                            }}
                            title="Refund is only possible after expiry"
                          >
                            Refund opens after expiry
                          </div>
                        )}
                      </>
                    )}

                    {/* Recipient Actions */}
                    {isRecipient && isPending && (
                      <>
                        {isInClaimWindow ? (
                          <button
                            type="button"
                            onClick={() => onNavigateToClaim(item.id)}
                            className="btn-primary px-4 py-1.5 text-xs flex items-center gap-1.5"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Claim Now
                          </button>
                        ) : isBeforeUnlock ? (
                          <div
                            className="text-[11px] px-3 py-1.5 rounded-lg"
                            style={{
                              color: 'rgba(143,163,199,0.4)',
                              background: 'rgba(10,15,30,0.5)',
                              border: '1px solid rgba(143,163,199,0.1)',
                            }}
                          >
                            Locked until unlock time
                          </div>
                        ) : (
                          <div
                            className="alert-warning text-[11px] px-3 py-1.5 inline-flex items-center gap-1"
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            Expired: Claim window closed
                          </div>
                        )}
                      </>
                    )}

                    {/* Non-participant viewer or terminal state */}
                    {!isPending && (
                      <span className="text-xs" style={{ color: 'rgba(143,163,199,0.4)' }}>
                        Completed · {STATE_LABELS[item.state]}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
};
