import React, { useState, useEffect } from 'react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { formatUnits } from 'viem';
import {
  RefreshCw,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  RotateCcw,
  Ban,
  ShieldCheck,
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

  useEffect(() => {
    if (isActionSuccess) {
      addToast({
        type: 'success',
        title: 'Transaction Confirmed',
        message: 'The transfer status has been updated on-chain.',
        txHash: actionTxHash,
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
      refetch();
    }
  }, [isActionSuccess, actionTxHash, actionVariables, addToast, refetch]);

  useEffect(() => {
    if (actionError) {
      addToast({
        type: 'error',
        title: 'Action Failed',
        message: decodeContractError(actionError),
      });
    }
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            My Transfers
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Track outgoing and incoming time-locked escrows. Reverse or refund when allowed.
          </p>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-slate-800/80 pb-3">
        <button
          onClick={() => setActiveFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeFilter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          All Transfers ({transfers.length})
        </button>
        <button
          onClick={() => setActiveFilter('sent')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeFilter === 'sent'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Sent (Outgoing)
        </button>
        <button
          onClick={() => setActiveFilter('received')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeFilter === 'received'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Received (Incoming)
        </button>
      </div>

      {/* Wallet Not Connected State */}
      {!isConnected && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto border border-indigo-500/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">Connect Wallet</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Please connect your wallet to view your sent and received SafeRevert escrow transfers.
          </p>
        </div>
      )}

      {/* Loading Skeleton — animate-pulse via Tailwind */}
      {isConnected && isLoading && transfers.length === 0 && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 animate-pulse space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="h-5 bg-slate-800 rounded w-1/4" />
                <div className="h-5 bg-slate-800 rounded w-16" />
              </div>
              <div className="h-4 bg-slate-800/60 rounded w-1/2" />
              <div className="h-8 bg-slate-800/40 rounded w-full" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {isConnected && error && transfers.length === 0 && (
        <div className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-6 text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
          <h4 className="text-sm font-bold text-rose-200">Unable to load transfers</h4>
          <p className="text-xs text-rose-300 max-w-md mx-auto">{error}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {isConnected && !isLoading && filteredTransfers.length === 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 bg-slate-800/80 text-slate-400 rounded-2xl flex items-center justify-center mx-auto">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-200">No Transfers Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
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
                  className="bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 shadow-lg transition-colors space-y-4"
                >
                  {/* Top Row: ID, Direction, Status Badge */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                        #{idStr}
                      </span>

                      {isSender && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                          <ArrowUpRight className="w-3 h-3" /> Sent (Outgoing)
                        </span>
                      )}

                      {isRecipient && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                          <ArrowDownLeft className="w-3 h-3" /> Received (Incoming)
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
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Done!
                          </motion.span>
                        )}
                      </AnimatePresence>

                      {/* Lifecycle State Badge — cross-fades on key change */}
                      <AnimatePresence mode="wait">
                        {isPending && (
                          <motion.span
                            key="pending"
                            variants={statusBadgeVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            Pending
                          </motion.span>
                        )}
                        {isClaimed && (
                          <motion.span
                            key="claimed"
                            variants={statusBadgeVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
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
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700"
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
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30"
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
                      <span className="text-slate-400 uppercase text-[10px] font-semibold">Amount</span>
                      <p className="text-base font-bold text-white mt-0.5">
                        {formattedAmount}{' '}
                        <span className="text-indigo-400 text-sm font-semibold">
                          {item.tokenSymbol || 'ETH'}
                        </span>
                      </p>
                    </div>

                    {/* Counterparty Address */}
                    <div>
                      <span className="text-slate-400 uppercase text-[10px] font-semibold">
                        {isSender ? 'Recipient' : 'Sender'}
                      </span>
                      <p className="font-mono text-slate-300 mt-0.5 truncate" title={isSender ? item.recipient : item.sender}>
                        {isSender ? item.recipient : item.sender}
                      </p>
                    </div>

                    {/* Live Status / Timing with countdown pulse */}
                    <div>
                      <span className="text-slate-400 uppercase text-[10px] font-semibold">
                        Live Timing
                      </span>
                      <div className="mt-0.5">
                        {isPending ? (
                          isBeforeUnlock ? (
                            <div
                              className={`text-indigo-300 font-semibold flex items-center gap-1 ${
                                shouldPulseUnlock ? 'animate-pulse' : ''
                              }`}
                            >
                              <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                              Unlocks in: {unlockCountdown.formatted}
                            </div>
                          ) : isInClaimWindow ? (
                            <div
                              className={`text-emerald-400 font-semibold flex items-center gap-1 ${
                                shouldPulseExpiry ? 'animate-pulse' : ''
                              }`}
                            >
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                              Claim window open (Expires: {expiryCountdown.formatted})
                            </div>
                          ) : (
                            <div className="text-amber-400 font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              Claim expired (Refundable by sender)
                            </div>
                          )
                        ) : (
                          <span className="text-slate-400">Terminal state</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Timestamps footer */}
                  <div className="pt-2 border-t border-slate-800/60 flex flex-wrap justify-between gap-2 text-[11px] text-slate-400 font-mono">
                    <span>Unlock: {formatLocalTimestamp(unlockTs)}</span>
                    <span>Expiry: {formatLocalTimestamp(expiryTs)}</span>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="pt-2 flex flex-wrap items-center justify-end gap-2.5">
                    {/* Sender Actions */}
                    {isSender && isPending && (
                      <>
                        {/* Cancel Button: Allowed only before unlock */}
                        {isBeforeUnlock ? (
                          <button
                            type="button"
                            onClick={() => handleCancel(item.id)}
                            disabled={isActionPending || isActionWaiting}
                            className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shadow transition disabled:opacity-50"
                          >
                            {(isActionPending || isActionWaiting) && (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            )}
                            Cancel &amp; Reclaim Funds
                          </button>
                        ) : (
                          <div
                            className="text-[11px] text-slate-500 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800"
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
                            className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 shadow transition disabled:opacity-50"
                          >
                            {(isActionPending || isActionWaiting) && (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            )}
                            Claim Sender Refund
                          </button>
                        ) : (
                          <div
                            className="text-[11px] text-slate-500 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800"
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
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Claim Now
                          </button>
                        ) : isBeforeUnlock ? (
                          <div className="text-[11px] text-slate-500 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                            Locked until unlock time
                          </div>
                        ) : (
                          <div className="text-[11px] text-rose-400 bg-rose-950/30 px-3 py-1.5 rounded-lg border border-rose-800/40">
                            Expired: Claim window closed
                          </div>
                        )}
                      </>
                    )}

                    {/* Non-participant viewer or terminal state */}
                    {!isPending && (
                      <span className="text-xs text-slate-500">
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
