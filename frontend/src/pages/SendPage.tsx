import React, { useState, useEffect, useMemo } from 'react';
import {
  useAccount,
  useBalance,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import {
  parseUnits,
  formatUnits,
  isAddress,
  type Address,
  type Hex,
  decodeEventLog,
} from 'viem';
import {
  ShieldAlert,
  Clock,
  KeyRound,
  Check,
  Copy,
  AlertTriangle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  backdropVariants,
  modalCardVariants,
  modalCardVariantsReduced,
  pickVariants,
} from '../lib/motion';
import { safeRevertVaultAbi, erc20Abi } from '../lib/abi';
import { VAULT_ADDRESS, TARGET_CHAIN } from '../lib/config';
import { NATIVE_TOKEN_ADDRESS } from '../lib/types';
import { useTokenInfo } from '../hooks/useTokenInfo';
import { useTransfers } from '../hooks/useTransfers';
import { useToast } from '../hooks/useToast';
import { decodeContractError } from '../lib/errors';
import {
  generateSecret,
  computeSecretHash,
  ZERO_SECRET_HASH,
} from '../lib/crypto';
import {
  PRESET_DELAYS,
  PRESET_EXPIRIES,
  computeUnlockTime,
  computeExpiryTime,
  validateDelay,
  validateExpiry,
  formatLocalTimestamp,
  formatDuration,
} from '../lib/time';

interface SendPageProps {
  onTransferCreated?: (id: bigint) => void;
}

export const SendPage: React.FC<SendPageProps> = ({ onTransferCreated }) => {
  const { address: userAddress, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { addToast } = useToast();
  const reduced = useReducedMotion() ?? false;
  const cardVariants = pickVariants(reduced, modalCardVariants, modalCardVariantsReduced);

  // Form states
  const [recipient, setRecipient] = useState('');
  const [isEth, setIsEth] = useState(true);
  const [tokenAddressInput, setTokenAddressInput] = useState('');
  const [amountInput, setAmountInput] = useState('');

  // Delay & Expiry states
  const [selectedDelaySeconds, setSelectedDelaySeconds] = useState<number>(15 * 60); // 15 mins
  const [isCustomDelay, setIsCustomDelay] = useState(false);
  const [customDelayMinutes, setCustomDelayMinutes] = useState('15');

  const [selectedExpiryWindowSeconds, setSelectedExpiryWindowSeconds] = useState<number>(24 * 60 * 60); // 24 hours
  const [isCustomExpiry, setIsCustomExpiry] = useState(false);
  const [customExpiryHours, setCustomExpiryHours] = useState('24');

  // Secret states (STRICT MEMORY ONLY - never persisted to storage/URL)
  const [secret, setSecret] = useState<string>(() => generateSecret());
  // Advanced opt-out is UNCHECKED by default: a fresh random 32-byte secret is
  // generated and used unless the user explicitly disables the secret check.
  const [useNoSecret, setUseNoSecret] = useState(false);

  // Review & Confirmation Modal
  const [isReviewing, setIsReviewing] = useState(false);
  // Safety checkbox: must be ticked before the final Confirm button is enabled
  const [addressConfirmed, setAddressConfirmed] = useState(false);

  // Success Modal (One-time reveal)
  const [successTransferId, setSuccessTransferId] = useState<bigint | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [userAcknowledgedSave, setUserAcknowledgedSave] = useState(false);

  // Fetch ETH balance
  const { data: ethBalanceData } = useBalance({
    address: userAddress,
  });

  // Fetch ERC-20 token info
  const tokenAddressToQuery = isEth ? undefined : tokenAddressInput;
  const {
    token: erc20Token,
    balance: erc20Balance,
    allowance: erc20Allowance,
    isLoading: isTokenLoading,
    refetch: refetchTokenInfo,
  } = useTokenInfo(tokenAddressToQuery);

  // Refresh the My Transfers list as soon as a new transfer is locked on-chain
  const { refetch: refetchTransfers } = useTransfers();

  // Compute active delay seconds
  const activeDelaySeconds = useMemo(() => {
    if (!isCustomDelay) return selectedDelaySeconds;
    const mins = parseFloat(customDelayMinutes);
    if (isNaN(mins)) return 0;
    return Math.floor(mins * 60);
  }, [isCustomDelay, selectedDelaySeconds, customDelayMinutes]);

  // Compute active expiry window seconds
  const activeExpiryWindowSeconds = useMemo(() => {
    if (!isCustomExpiry) return selectedExpiryWindowSeconds;
    const hrs = parseFloat(customExpiryHours);
    if (isNaN(hrs)) return 0;
    return Math.floor(hrs * 3600);
  }, [isCustomExpiry, selectedExpiryWindowSeconds, customExpiryHours]);

  // Timestamps preview (based on client time)
  const [currentClientTime, setCurrentClientTime] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentClientTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const previewUnlockTimestamp = useMemo(() => {
    return computeUnlockTime(currentClientTime, activeDelaySeconds);
  }, [currentClientTime, activeDelaySeconds]);

  const previewExpiryTimestamp = useMemo(() => {
    try {
      return computeExpiryTime(previewUnlockTimestamp, activeExpiryWindowSeconds);
    } catch {
      return 0;
    }
  }, [previewUnlockTimestamp, activeExpiryWindowSeconds]);

  // Secret Hash computation
  const activeSecretHash: Hex = useMemo(() => {
    if (useNoSecret) return ZERO_SECRET_HASH;
    return computeSecretHash(secret);
  }, [useNoSecret, secret]);

  // Amount parsing
  const activeDecimals = isEth ? 18 : erc20Token?.decimals ?? 18;
  const parsedAmount = useMemo(() => {
    try {
      if (!amountInput || parseFloat(amountInput) <= 0) return 0n;
      return parseUnits(amountInput, activeDecimals);
    } catch {
      return 0n;
    }
  }, [amountInput, activeDecimals]);

  // Validation
  const recipientValid = isAddress(recipient) && recipient.toLowerCase() !== VAULT_ADDRESS.toLowerCase();
  const delayValidation = validateDelay(activeDelaySeconds);
  const expiryValidation = validateExpiry(previewExpiryTimestamp, previewUnlockTimestamp);

  const activeBalance = isEth
    ? ethBalanceData?.value ?? 0n
    : erc20Balance ?? 0n;

  const hasSufficientBalance = activeBalance >= parsedAmount && parsedAmount > 0n;

  const isFormValid =
    recipientValid &&
    parsedAmount > 0n &&
    hasSufficientBalance &&
    delayValidation.valid &&
    expiryValidation.valid &&
    (isEth || Boolean(erc20Token));

  // Allowance check for ERC-20
  const needsApproval =
    !isEth &&
    Boolean(erc20Token) &&
    (erc20Allowance === undefined || erc20Allowance < parsedAmount);

  // Wagmi Write Contracts
  const {
    writeContract: executeApprove,
    data: approveTxHash,
    isPending: isApprovePending,
    error: approveError,
  } = useWriteContract();

  const {
    writeContract: executeCreateTransfer,
    data: createTxHash,
    isPending: isCreatePending,
    error: createError,
  } = useWriteContract();

  // Wait for Approve receipt
  const {
    isLoading: isApproveWaiting,
    isSuccess: isApproveSuccess,
  } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  // Wait for CreateTransfer receipt
  const {
    isLoading: isCreateWaiting,
    isSuccess: isCreateSuccess,
    data: createReceipt,
  } = useWaitForTransactionReceipt({
    hash: createTxHash,
  });

  // Re-fetch allowance when approve succeeds
  useEffect(() => {
    if (isApproveSuccess) {
      addToast({
        type: 'success',
        title: 'Approval Confirmed',
        message: 'Vault approved to transfer tokens. You can now finalize the transfer.',
        txHash: approveTxHash,
      });
      refetchTokenInfo();
    }
  }, [isApproveSuccess, approveTxHash, addToast, refetchTokenInfo]);

  // Handle Approve Error
  useEffect(() => {
    if (approveError) {
      addToast({
        type: 'error',
        title: 'Approval Failed',
        message: decodeContractError(approveError),
      });
    }
  }, [approveError, addToast]);

  // Handle Create Transfer Error
  useEffect(() => {
    if (createError) {
      addToast({
        type: 'error',
        title: 'Transfer Failed',
        message: decodeContractError(createError),
      });
    }
  }, [createError, addToast]);

  // Handle Create Transfer Success
  useEffect(() => {
    if (isCreateSuccess && createReceipt) {
      // Find transfer id from TransferCreated event log
      let createdId: bigint | null = null;
      for (const log of createReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: safeRevertVaultAbi,
            eventName: 'TransferCreated',
            data: log.data,
            topics: log.topics,
          });
          if (decoded && decoded.args.id !== undefined) {
            createdId = decoded.args.id;
            break;
          }
        } catch {
          // continue
        }
      }

      const finalId = createdId ?? 0n;
      setSuccessTransferId(finalId);
      // Retain secret in memory for one-time revelation modal
      setRevealedSecret(useNoSecret ? null : secret);
      // The next transfer starts secret-protected again (only the value that
      // was just locked on-chain is kept, in revealedSecret above)
      setUseNoSecret(false);

      addToast({
        type: 'success',
        title: 'Transfer Locked in SafeRevert Vault!',
        message: `Transfer #${finalId.toString()} has been created. Save your secret now.`,
        txHash: createTxHash,
      });

      if (onTransferCreated) {
        onTransferCreated(finalId);
      }

      // The new transfer must show up in My Transfers immediately
      refetchTransfers();

      setIsReviewing(false);
    }
  }, [isCreateSuccess, createReceipt, createTxHash, secret, useNoSecret, addToast, onTransferCreated, refetchTransfers]);

  // Handle Approval Action
  const handleApprove = () => {
    if (!erc20Token) return;
    executeApprove({
      address: erc20Token.address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [VAULT_ADDRESS, parsedAmount],
      chainId: TARGET_CHAIN.id,
    });
  };

  // Handle Create Transfer Action
  const handleCreateTransfer = async () => {
    if (!recipientValid || parsedAmount <= 0n) return;

    try {
      // Fetch latest block timestamp from network to be strictly accurate
      let blockNow = Math.floor(Date.now() / 1000);
      if (publicClient) {
        const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
        blockNow = Number(latestBlock.timestamp);
      }

      const calculatedUnlockTime = blockNow + activeDelaySeconds;
      const calculatedExpiry = calculatedUnlockTime + activeExpiryWindowSeconds;

      const tokenAddr = isEth ? NATIVE_TOKEN_ADDRESS : (erc20Token?.address as Address);

      executeCreateTransfer({
        address: VAULT_ADDRESS,
        abi: safeRevertVaultAbi,
        functionName: 'createTransfer',
        args: [
          recipient as Address,
          tokenAddr,
          parsedAmount,
          BigInt(activeDelaySeconds),
          BigInt(calculatedExpiry),
          activeSecretHash,
        ],
        value: isEth ? parsedAmount : 0n,
        chainId: TARGET_CHAIN.id,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Error Creating Transfer',
        message: decodeContractError(err),
      });
    }
  };

  const resetForm = () => {
    setRecipient('');
    setAmountInput('');
    setSecret(generateSecret());
    // Always come back to a secret-protected transfer on a fresh form
    setUseNoSecret(false);
    setSuccessTransferId(null);
    setRevealedSecret(null);
    setUserAcknowledgedSave(false);
    setCopiedSecret(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Title & Description */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Send with SafeRevert
        </h1>
        <p className="mt-2 text-sm text-slate-400 max-w-lg mx-auto">
          Send crypto with a time-lock escrow. Reverse wrong address sends before unlock, protected by an optional one-time secret.
        </p>
      </div>

      {/* Main Send Form Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isFormValid) {
              setAddressConfirmed(false);
              setIsReviewing(true);
            }
          }}
          className="space-y-6"
        >
          {/* Recipient Address */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Recipient Address
              </label>
              {recipient && !recipientValid && (
                <span className="text-xs text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Invalid address
                </span>
              )}
            </div>
            <input
              type="text"
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              className={`w-full px-4 py-2.5 rounded-xl bg-slate-950/80 border text-slate-100 placeholder-slate-500 font-mono text-sm focus:outline-none focus:ring-2 transition ${
                recipient && !recipientValid
                  ? 'border-rose-500/60 focus:ring-rose-500/30'
                  : 'border-slate-800 focus:border-indigo-500 focus:ring-indigo-500/30'
              }`}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Only this recipient address will be authorized to claim the funds after unlock.
            </p>
          </div>

          {/* Asset Selection & Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Asset Selector */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Asset
              </label>
              <div className="flex rounded-xl bg-slate-950/80 p-1 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEth(true)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition ${
                    isEth
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ETH (Native)
                </button>
                <button
                  type="button"
                  onClick={() => setIsEth(false)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition ${
                    !isEth
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ERC-20 Token
                </button>
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Amount
                </label>
                {isConnected && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isEth && ethBalanceData) {
                        // Keep a small buffer for gas
                        const raw = ethBalanceData.value;
                        const buffer = parseUnits('0.005', 18);
                        const maxVal = raw > buffer ? raw - buffer : raw;
                        setAmountInput(formatUnits(maxVal, 18));
                      } else if (!isEth && erc20Balance !== undefined && erc20Token) {
                        setAmountInput(formatUnits(erc20Balance, erc20Token.decimals));
                      }
                    }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    Max:{' '}
                    {isEth && ethBalanceData
                      ? `${parseFloat(formatUnits(ethBalanceData.value, 18)).toFixed(4)} ETH`
                      : !isEth && erc20Balance !== undefined && erc20Token
                      ? `${parseFloat(formatUnits(erc20Balance, erc20Token.decimals)).toFixed(2)} ${erc20Token.symbol}`
                      : '—'}
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  placeholder="0.0"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 placeholder-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:border-indigo-500 focus:ring-indigo-500/30 transition"
                />
                <span className="absolute right-3.5 top-2.5 text-xs font-semibold text-slate-400 pointer-events-none">
                  {isEth ? 'ETH' : erc20Token?.symbol || 'TOKEN'}
                </span>
              </div>
            </div>
          </div>

          {/* ERC-20 Address Input (if ERC-20 selected) */}
          {!isEth && (
            <div className="p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-slate-300">
                  ERC-20 Contract Address
                </label>
                {isTokenLoading && (
                  <span className="text-xs text-indigo-400 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Looking up token...
                  </span>
                )}
              </div>
              <input
                type="text"
                placeholder="0x... (ERC-20 address on Sepolia)"
                value={tokenAddressInput}
                onChange={(e) => setTokenAddressInput(e.target.value.trim())}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700/80 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {erc20Token && (
                <div className="flex items-center justify-between text-xs text-emerald-400 pt-1">
                  <span>
                    Found: <strong>{erc20Token.name}</strong> ({erc20Token.symbol}) · Decimals: {erc20Token.decimals}
                  </span>
                  <span>
                    Balance: {erc20Balance !== undefined ? formatUnits(erc20Balance, erc20Token.decimals) : '0'} {erc20Token.symbol}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Time-lock Delay Options */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Time-Lock Delay
              </label>
              <span className="text-xs text-slate-400">
                Cancelable for: <strong>{formatDuration(activeDelaySeconds)}</strong>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {PRESET_DELAYS.map((preset) => (
                <button
                  key={preset.seconds}
                  type="button"
                  onClick={() => {
                    setIsCustomDelay(false);
                    setSelectedDelaySeconds(preset.seconds);
                  }}
                  className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition ${
                    !isCustomDelay && selectedDelaySeconds === preset.seconds
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsCustomDelay(true)}
                className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition ${
                  isCustomDelay
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom Delay Input */}
            {isCustomDelay && (
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={customDelayMinutes}
                  onChange={(e) => setCustomDelayMinutes(e.target.value)}
                  className="w-32 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-slate-200"
                  placeholder="Minutes"
                />
                <span className="text-xs text-slate-400">
                  Minutes (allowed: 1 min to 24 hours / 1440 min)
                </span>
              </div>
            )}
            {!delayValidation.valid && (
              <p className="mt-1 text-xs text-rose-400">{delayValidation.error}</p>
            )}
          </div>

          {/* Expiry Window Options */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Recipient Claim Window (Expiry)
              </label>
              <span className="text-xs text-slate-400">
                Duration: <strong>{formatDuration(activeExpiryWindowSeconds)}</strong>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              {PRESET_EXPIRIES.map((preset) => (
                <button
                  key={preset.secondsAfterUnlock}
                  type="button"
                  onClick={() => {
                    setIsCustomExpiry(false);
                    setSelectedExpiryWindowSeconds(preset.secondsAfterUnlock);
                  }}
                  className={`py-2 px-2 rounded-xl text-xs font-medium border transition text-center ${
                    !isCustomExpiry && selectedExpiryWindowSeconds === preset.secondsAfterUnlock
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsCustomExpiry(true)}
                className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition text-center ${
                  isCustomExpiry
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                Custom Hours
              </button>
            </div>

            {/* Custom Expiry Input */}
            {isCustomExpiry && (
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={customExpiryHours}
                  onChange={(e) => setCustomExpiryHours(e.target.value)}
                  className="w-32 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-slate-200"
                  placeholder="Hours"
                />
                <span className="text-xs text-slate-400">Hours after unlock</span>
              </div>
            )}
            {!expiryValidation.valid && (
              <p className="mt-1 text-xs text-rose-400">{expiryValidation.error}</p>
            )}
          </div>

          {/* Time Preview Box */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold mb-1">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Timelock Schedule Preview (Your Local Time)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-800/80">
              <div>
                <span className="text-slate-400">Unlock Time (Claim opens):</span>
                <p className="font-mono text-indigo-300 font-medium mt-0.5">
                  {formatLocalTimestamp(previewUnlockTimestamp)}
                </p>
                <p className="text-[11px] text-slate-500">
                  (Sender can cancel until this moment)
                </p>
              </div>
              <div>
                <span className="text-slate-400">Expiry Time (Refund opens):</span>
                <p className="font-mono text-amber-300 font-medium mt-0.5">
                  {formatLocalTimestamp(previewExpiryTimestamp)}
                </p>
                <p className="text-[11px] text-slate-500">
                  (Claim window closes; sender can refund after this)
                </p>
              </div>
            </div>
          </div>

          {/* Secret Security Configuration */}
          <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Claim Secret
                </span>
              </div>
              {!useNoSecret && (
                <button
                  type="button"
                  onClick={() => setSecret(generateSecret())}
                  className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
                >
                  <RefreshCw className="w-3 h-3" /> Regenerate
                </button>
              )}
            </div>

            {!useNoSecret ? (
              <div>
                <p className="text-xs text-slate-400 leading-relaxed mb-2">
                  A high-entropy 32-byte secret is generated in memory. The contract will only record its cryptographic hash commitment. The recipient will need this secret to claim the funds.
                </p>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-emerald-300 break-all select-none">
                  {secret.slice(0, 16)}••••••••••••••••••••••••••••••••••••••••{secret.slice(-8)}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Commitment Hash:{' '}
                  <span className="font-mono text-slate-400">{activeSecretHash.slice(0, 14)}...{activeSecretHash.slice(-8)}</span>
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-600/30 text-amber-300 text-xs">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-semibold">Secret Check Disabled:</strong> Anyone with the recipient wallet's private key will be able to claim without a secret once unlocked.
                  </div>
                </div>
              </div>
            )}

            {/* Advanced toggle */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span className="text-xs text-slate-400">Advanced Option</span>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={useNoSecret}
                  onChange={(e) => setUseNoSecret(e.target.checked)}
                  autoComplete="off"
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                Disable Secret (Zero Hash)
              </label>
            </div>
          </div>

          {/* Action Button */}
          <div>
            {!isConnected ? (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-center text-xs text-slate-400">
                Please connect your wallet to create a transfer.
              </div>
            ) : chain?.id !== TARGET_CHAIN.id ? (
              <div className="p-3 bg-amber-950/40 border border-amber-600/30 rounded-xl text-center text-xs text-amber-300">
                Switch to Sepolia network to create transfers.
              </div>
            ) : (
              <button
                type="submit"
                disabled={!isFormValid}
                className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-500 hover:from-indigo-500 hover:to-emerald-400 text-white shadow-lg shadow-indigo-600/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all transform active:scale-[0.99]"
              >
                Review & Confirm Transfer
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {isReviewing && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5"
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-indigo-400" />
                Confirm Time-Locked Escrow
              </h3>
              <button
                onClick={() => setIsReviewing(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {/* Full Recipient Address Display (4-character groups for easy comparison) */}
            <div className="space-y-3 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 uppercase font-semibold text-[10px]">
                  Recipient (Full Address)
                </span>
                <p className="font-mono text-sm text-slate-100 break-all mt-1 select-all tracking-wider">
                  {(recipient.match(/.{1,4}/g) ?? [recipient]).join(' ')}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Full 42-character address, shown in 4-character groups — compare it character by character with the recipient.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400 uppercase font-semibold text-[10px]">Amount</span>
                  <p className="text-base font-bold text-emerald-400 mt-0.5">
                    {amountInput} {isEth ? 'ETH' : erc20Token?.symbol}
                  </p>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400 uppercase font-semibold text-[10px]">
                    Cancel Window
                  </span>
                  <p className="text-base font-bold text-indigo-400 mt-0.5">
                    {formatDuration(activeDelaySeconds)}
                  </p>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-semibold">
                    Unlock Time (Your Local Time)
                  </span>
                  <p className="font-mono text-slate-200 mt-0.5">
                    {formatLocalTimestamp(previewUnlockTimestamp)}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-slate-400 text-[10px] uppercase font-semibold">
                    Expiry Time (Your Local Time)
                  </span>
                  <p className="font-mono text-amber-300 mt-0.5">
                    {formatLocalTimestamp(previewExpiryTimestamp)}
                  </p>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-[10px] uppercase font-semibold">
                  Secret Protection Commitment
                </span>
                <p className="font-mono text-[11px] text-slate-400 mt-0.5 break-all">
                  {useNoSecret ? 'None (Zero Hash Disabled)' : activeSecretHash}
                </p>
              </div>
            </div>

            {/* Double-check confirmation gate */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-700">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={addressConfirmed}
                  onChange={(e) => setAddressConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded bg-slate-900 border-slate-600 text-indigo-600 focus:ring-0"
                />
                <span>
                  <strong className="font-semibold">I have double-checked the recipient address</strong>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    Funds can only be recovered by the recipient after expiry — verify every character above.
                  </span>
                </span>
              </label>
            </div>

            {/* Approval & Execute Buttons */}
            <div className="space-y-3 pt-2">
              {needsApproval ? (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={isApprovePending || isApproveWaiting}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-amber-600 hover:bg-amber-500 text-white flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                >
                  {(isApprovePending || isApproveWaiting) && (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  )}
                  {isApprovePending
                    ? 'Confirm Approval in Wallet...'
                    : isApproveWaiting
                    ? 'Confirming Approval on Sepolia...'
                    : `Approve Vault to Spend ${erc20Token?.symbol}`}
                </button>
              ) : (
                <>
                <button
                  type="button"
                  onClick={handleCreateTransfer}
                  disabled={!addressConfirmed || isCreatePending || isCreateWaiting}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(isCreatePending || isCreateWaiting) && (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  )}
                  {isCreatePending
                    ? 'Confirm Transfer in Wallet...'
                    : isCreateWaiting
                    ? 'Locking Funds in Vault...'
                    : 'Confirm & Lock Funds'}
                </button>
                {!addressConfirmed && !(isCreatePending || isCreateWaiting) && (
                  <p className="text-[11px] text-amber-400 text-center">
                    Tick the checkbox above to enable Confirm.
                  </p>
                )}
                </>
              )}

              <button
                type="button"
                onClick={() => setIsReviewing(false)}
                disabled={isCreatePending || isCreateWaiting || isApprovePending || isApproveWaiting}
                className="w-full py-2 text-xs text-slate-400 hover:text-slate-200"
              >
                Back to Edit
              </button>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>

      {/* Post-Success One-Time Secret Reveal Modal */}
      <AnimatePresence>
        {revealedSecret !== null && successTransferId !== null && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="bg-slate-900 border-2 border-emerald-500/60 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5"
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
            <div className="text-center">
              <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-emerald-500/20">
                <Sparkles className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white">Transfer Successfully Locked!</h2>
              <p className="text-xs text-slate-400 mt-1">
                Transfer ID: <strong className="text-white font-mono text-sm">#{successTransferId.toString()}</strong>
              </p>
            </div>

            {/* Warning Box */}
            <div className="bg-amber-950/40 border border-amber-600/40 rounded-xl p-3.5 text-xs text-amber-200 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Save This Secret Now (Shown Only Once)</span>
              </div>
              <p className="leading-relaxed text-[11px] opacity-90">
                Share this secret with the recipient through a separate, private channel (e.g. Signal, Telegram, encrypted email). It is <strong>NOT</strong> stored anywhere, cannot be retrieved from on-chain logs or browser storage, and cannot be recovered if lost!
              </p>
            </div>

            {/* Secret Reveal with Copy */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase text-slate-300">
                Claim Secret String
              </label>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                <input
                  type="text"
                  readOnly
                  value={revealedSecret}
                  className="w-full bg-transparent font-mono text-xs text-emerald-400 select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(revealedSecret);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 3000);
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-xs transition shrink-0"
                >
                  {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedSecret ? 'Copied!' : 'Copy Secret'}
                </button>
              </div>
            </div>

            {/* Acknowledgment Checkbox */}
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950/50 border border-slate-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={userAcknowledgedSave}
                onChange={(e) => setUserAcknowledgedSave(e.target.checked)}
                className="mt-0.5 rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
              />
              <span className="text-xs text-slate-300 leading-tight">
                I have securely copied and shared this secret. I understand it will be wiped from browser memory when I close this modal.
              </span>
            </label>

            {/* Done Button */}
            <button
              type="button"
              disabled={!userAcknowledgedSave}
              onClick={() => {
                // Clear secret from memory completely
                resetForm();
              }}
              className="w-full py-3 rounded-xl font-bold text-sm bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              I am Done (Clear Secret from Memory)
            </button>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
