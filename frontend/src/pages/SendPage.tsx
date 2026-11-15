import React, { useState, useEffect, useMemo, useRef } from 'react';
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

// ─── Shared input style helpers ───────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: '12px',
  background: 'rgba(10,15,30,0.6)',
  border: '1px solid rgba(143,163,199,0.16)',
  color: 'rgba(255,255,255,0.92)',
  fontFamily: 'Inter, sans-serif',
  fontSize: '14px',
  outline: 'none',
  transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
};

const inputFocusHandlers = {
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'rgba(232,116,59,0.5)';
    e.target.style.boxShadow = '0 0 0 3px rgba(232,116,59,0.12)';
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'rgba(143,163,199,0.16)';
    e.target.style.boxShadow = 'none';
  },
};

const inputErrorHandlers = {
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'rgba(232,116,59,0.6)';
    e.target.style.boxShadow = '0 0 0 3px rgba(232,116,59,0.12)';
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'rgba(232,116,59,0.4)';
    e.target.style.boxShadow = 'none';
  },
};

// Preset pill button style
const presetBtnStyle = (active: boolean): React.CSSProperties =>
  active
    ? {
        background: 'rgba(232,116,59,0.12)',
        border: '1px solid rgba(232,116,59,0.4)',
        color: 'var(--copper)',
        borderRadius: '10px',
        padding: '7px 10px',
        fontSize: '12px',
        fontWeight: 600,
        transition: 'all 0.15s ease',
        cursor: 'pointer',
      }
    : {
        background: 'rgba(10,15,30,0.5)',
        border: '1px solid rgba(143,163,199,0.14)',
        color: 'rgba(143,163,199,0.65)',
        borderRadius: '10px',
        padding: '7px 10px',
        fontSize: '12px',
        fontWeight: 500,
        transition: 'all 0.15s ease',
        cursor: 'pointer',
      };

// Section label
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label
    className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
    style={{ color: 'rgba(255,255,255,0.65)' }}
  >
    {children}
  </label>
);

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
  const [selectedDelaySeconds, setSelectedDelaySeconds] = useState<number>(15 * 60);
  const [isCustomDelay, setIsCustomDelay] = useState(false);
  const [customDelayMinutes, setCustomDelayMinutes] = useState('15');

  const [selectedExpiryWindowSeconds, setSelectedExpiryWindowSeconds] = useState<number>(24 * 60 * 60);
  const [isCustomExpiry, setIsCustomExpiry] = useState(false);
  const [customExpiryHours, setCustomExpiryHours] = useState('24');

  // Secret states (STRICT MEMORY ONLY - never persisted to storage/URL)
  const [secret, setSecret] = useState<string>(() => generateSecret());
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
  const { data: ethBalanceData } = useBalance({ address: userAddress });

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

  // --- Once-per-transaction guards & latest-value refs -----------------------
  const refetchTransfersRef = useRef(refetchTransfers);
  const refetchTokenInfoRef = useRef(refetchTokenInfo);
  const onTransferCreatedRef = useRef(onTransferCreated);
  useEffect(() => {
    refetchTransfersRef.current = refetchTransfers;
    refetchTokenInfoRef.current = refetchTokenInfo;
    onTransferCreatedRef.current = onTransferCreated;
  });

  const handledApproveTxRef = useRef<string | null>(null);
  const handledCreateTxRef = useRef<string | null>(null);
  const handledApproveErrorRef = useRef<unknown>(null);
  const handledCreateErrorRef = useRef<unknown>(null);

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

  const activeBalance = isEth ? ethBalanceData?.value ?? 0n : erc20Balance ?? 0n;
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
  } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // Wait for CreateTransfer receipt
  const {
    isLoading: isCreateWaiting,
    isSuccess: isCreateSuccess,
    data: createReceipt,
  } = useWaitForTransactionReceipt({ hash: createTxHash });

  // Re-fetch allowance when approve succeeds
  useEffect(() => {
    if (!isApproveSuccess || !approveTxHash) return;
    if (handledApproveTxRef.current === approveTxHash) return;
    handledApproveTxRef.current = approveTxHash;
    addToast({
      type: 'success',
      title: 'Approval Confirmed',
      message: 'Vault approved to transfer tokens. You can now finalize the transfer.',
      txHash: approveTxHash,
      key: approveTxHash,
    });
    refetchTokenInfoRef.current();
  }, [isApproveSuccess, approveTxHash, addToast]);

  // Handle Approve Error
  useEffect(() => {
    if (!approveError || handledApproveErrorRef.current === approveError) return;
    handledApproveErrorRef.current = approveError;
    addToast({
      type: 'error',
      title: 'Approval Failed',
      message: decodeContractError(approveError),
    });
  }, [approveError, addToast]);

  // Handle Create Transfer Error
  useEffect(() => {
    if (!createError || handledCreateErrorRef.current === createError) return;
    handledCreateErrorRef.current = createError;
    addToast({
      type: 'error',
      title: 'Transfer Failed',
      message: decodeContractError(createError),
    });
  }, [createError, addToast]);

  // Handle Create Transfer Success
  useEffect(() => {
    if (!isCreateSuccess || !createReceipt) return;
    const txKey = createTxHash ?? '';
    if (handledCreateTxRef.current === txKey) return;
    handledCreateTxRef.current = txKey;

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
    setRevealedSecret(useNoSecret ? null : secret);
    setUseNoSecret(false);

    addToast({
      type: 'success',
      title: 'Transfer Locked in SafeRevert Vault!',
      message: `Transfer #${finalId.toString()} has been created. Save your secret now.`,
      txHash: createTxHash,
      key: txKey,
    });

    onTransferCreatedRef.current?.(finalId);
    refetchTransfersRef.current();
    setIsReviewing(false);
  }, [isCreateSuccess, createReceipt, createTxHash, secret, useNoSecret, addToast]);

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
    setUseNoSecret(false);
    setSuccessTransferId(null);
    setRevealedSecret(null);
    setUserAcknowledgedSave(false);
    setCopiedSecret(false);
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Hero title */}
      <div className="mb-8 text-center relative">
        {/* subtle copper glow behind heading */}
        <div
          className="absolute inset-x-0 bottom-0 h-32 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 60% 50% at 50% 100%, rgba(232,116,59,0.1) 0%, transparent 70%)',
          }}
        />
        <h1
          className="font-serif text-3xl sm:text-4xl font-bold tracking-tight relative"
          style={{ color: 'rgba(255,255,255,0.92)' }}
        >
          Send with SafeRevert
        </h1>
        <p className="mt-2 text-sm max-w-lg mx-auto relative" style={{ color: 'var(--silver-blue)' }}>
          Send crypto with a time-lock escrow. Reverse wrong address sends before unlock, protected by an optional one-time secret.
        </p>
      </div>

      {/* Main Send Form Card */}
      <div className="glass-card p-6">
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
              <SectionLabel>Recipient Address</SectionLabel>
              {recipient && !recipientValid && (
                <span
                  className="text-xs flex items-center gap-1"
                  style={{ color: 'var(--copper)' }}
                >
                  <AlertTriangle className="w-3 h-3" /> Invalid address
                </span>
              )}
            </div>
            <input
              type="text"
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              style={{
                ...inputStyle,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                borderColor: recipient && !recipientValid
                  ? 'rgba(232,116,59,0.5)'
                  : 'rgba(143,163,199,0.16)',
              }}
              {...(recipient && !recipientValid ? inputErrorHandlers : inputFocusHandlers)}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'rgba(143,163,199,0.4)' }}>
              Only this recipient address will be authorized to claim the funds after unlock.
            </p>
          </div>

          {/* Asset Selection & Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Asset Selector */}
            <div>
              <SectionLabel>Asset</SectionLabel>
              <div
                className="flex rounded-xl p-1"
                style={{ background: 'rgba(10,15,30,0.5)', border: '1px solid rgba(143,163,199,0.14)' }}
              >
                {[{ label: 'ETH (Native)', value: true }, { label: 'ERC-20 Token', value: false }].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setIsEth(opt.value)}
                    /* Active option is copper-filled → .btn-primary, so the
                       shared glow comes from the one class (no inline bg). */
                    className={
                      isEth === opt.value
                        ? 'btn-primary flex-1 py-1.5 rounded-lg text-xs'
                        : 'flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200'
                    }
                    style={
                      isEth === opt.value
                        ? undefined
                        : { color: 'rgba(143,163,199,0.65)', background: 'transparent' }
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <SectionLabel>Amount</SectionLabel>
                {isConnected && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isEth && ethBalanceData) {
                        const raw = ethBalanceData.value;
                        const buffer = parseUnits('0.005', 18);
                        const maxVal = raw > buffer ? raw - buffer : raw;
                        setAmountInput(formatUnits(maxVal, 18));
                      } else if (!isEth && erc20Balance !== undefined && erc20Token) {
                        setAmountInput(formatUnits(erc20Balance, erc20Token.decimals));
                      }
                    }}
                    className="text-[11px] font-medium transition-opacity hover:opacity-80"
                    style={{ color: 'var(--copper)' }}
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
                  style={{
                    ...inputStyle,
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    paddingRight: '56px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  {...inputFocusHandlers}
                />
                <span
                  className="absolute right-3.5 top-2.5 text-xs font-semibold pointer-events-none"
                  style={{ color: 'var(--silver-blue)' }}
                >
                  {isEth ? 'ETH' : erc20Token?.symbol || 'TOKEN'}
                </span>
              </div>
            </div>
          </div>

          {/* ERC-20 Address Input (if ERC-20 selected) */}
          {!isEth && (
            <div
              className="p-3.5 rounded-xl space-y-2"
              style={{ background: 'rgba(10,15,30,0.5)', border: '1px solid rgba(143,163,199,0.14)' }}
            >
              <div className="flex justify-between items-center">
                <label
                  className="text-xs font-semibold"
                  style={{ color: 'rgba(255,255,255,0.7)' }}
                >
                  ERC-20 Contract Address
                </label>
                {isTokenLoading && (
                  <span
                    className="text-xs flex items-center gap-1"
                    style={{ color: 'var(--silver-blue)' }}
                  >
                    <RefreshCw className="w-3 h-3 animate-spin" /> Looking up token...
                  </span>
                )}
              </div>
              <input
                type="text"
                placeholder="0x... (ERC-20 address on Sepolia)"
                value={tokenAddressInput}
                onChange={(e) => setTokenAddressInput(e.target.value.trim())}
                style={{
                  ...inputStyle,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '12px',
                  padding: '8px 12px',
                }}
                {...inputFocusHandlers}
              />
              {erc20Token && (
                <div
                  className="flex items-center justify-between text-xs pt-1"
                  style={{ color: 'var(--copper)' }}
                >
                  <span>
                    Found: <strong>{erc20Token.name}</strong> ({erc20Token.symbol}) · Decimals: {erc20Token.decimals}
                  </span>
                  <span className="font-tabular">
                    Balance: {erc20Balance !== undefined ? formatUnits(erc20Balance, erc20Token.decimals) : '0'} {erc20Token.symbol}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Time-lock Delay Options */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <SectionLabel>Time-Lock Delay</SectionLabel>
              <span className="text-xs" style={{ color: 'var(--silver-blue)' }}>
                Cancelable for: <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{formatDuration(activeDelaySeconds)}</strong>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {PRESET_DELAYS.map((preset) => (
                <button
                  key={preset.seconds}
                  type="button"
                  onClick={() => { setIsCustomDelay(false); setSelectedDelaySeconds(preset.seconds); }}
                  style={presetBtnStyle(!isCustomDelay && selectedDelaySeconds === preset.seconds)}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsCustomDelay(true)}
                style={presetBtnStyle(isCustomDelay)}
              >
                Custom
              </button>
            </div>
            {isCustomDelay && (
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={customDelayMinutes}
                  onChange={(e) => setCustomDelayMinutes(e.target.value)}
                  style={{
                    ...inputStyle,
                    width: '128px',
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '12px',
                    padding: '6px 12px',
                  }}
                  {...inputFocusHandlers}
                  placeholder="Minutes"
                />
                <span className="text-xs" style={{ color: 'var(--silver-blue)' }}>
                  Minutes (1 min to 24 hours / 1440 min)
                </span>
              </div>
            )}
            {!delayValidation.valid && (
              <p className="mt-1 text-xs flex items-center gap-1" style={{ color: 'var(--copper)' }}>
                <AlertTriangle className="w-3 h-3" /> {delayValidation.error}
              </p>
            )}
          </div>

          {/* Expiry Window Options */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <SectionLabel>Recipient Claim Window (Expiry)</SectionLabel>
              <span className="text-xs" style={{ color: 'var(--silver-blue)' }}>
                Duration: <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{formatDuration(activeExpiryWindowSeconds)}</strong>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              {PRESET_EXPIRIES.map((preset) => (
                <button
                  key={preset.secondsAfterUnlock}
                  type="button"
                  onClick={() => { setIsCustomExpiry(false); setSelectedExpiryWindowSeconds(preset.secondsAfterUnlock); }}
                  style={{ ...presetBtnStyle(!isCustomExpiry && selectedExpiryWindowSeconds === preset.secondsAfterUnlock), textAlign: 'center' }}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsCustomExpiry(true)}
                style={{ ...presetBtnStyle(isCustomExpiry), textAlign: 'center' }}
              >
                Custom Hours
              </button>
            </div>
            {isCustomExpiry && (
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={customExpiryHours}
                  onChange={(e) => setCustomExpiryHours(e.target.value)}
                  style={{
                    ...inputStyle,
                    width: '128px',
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '12px',
                    padding: '6px 12px',
                  }}
                  {...inputFocusHandlers}
                  placeholder="Hours"
                />
                <span className="text-xs" style={{ color: 'var(--silver-blue)' }}>
                  Hours after unlock
                </span>
              </div>
            )}
            {!expiryValidation.valid && (
              <p className="mt-1 text-xs flex items-center gap-1" style={{ color: 'var(--copper)' }}>
                <AlertTriangle className="w-3 h-3" /> {expiryValidation.error}
              </p>
            )}
          </div>

          {/* Time Preview Box */}
          <div
            className="rounded-xl p-3.5 space-y-2 text-xs"
            style={{ background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(143,163,199,0.12)' }}
          >
            <div
              className="flex items-center gap-1.5 font-semibold mb-1"
              style={{ color: 'rgba(255,255,255,0.75)' }}
            >
              <Clock className="w-3.5 h-3.5" style={{ color: 'var(--silver-blue)' }} />
              <span>Timelock Schedule Preview (Your Local Time)</span>
            </div>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1"
              style={{ borderTop: '1px solid rgba(143,163,199,0.08)' }}
            >
              <div>
                <span style={{ color: 'var(--silver-blue)' }}>Unlock Time (Claim opens):</span>
                <p
                  className="font-mono font-medium mt-0.5"
                  style={{ color: 'var(--silver-blue)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatLocalTimestamp(previewUnlockTimestamp)}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(143,163,199,0.4)' }}>
                  (Sender can cancel until this moment)
                </p>
              </div>
              <div>
                <span style={{ color: 'var(--silver-blue)' }}>Expiry Time (Refund opens):</span>
                <p
                  className="font-mono font-medium mt-0.5"
                  style={{ color: 'var(--copper)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatLocalTimestamp(previewExpiryTimestamp)}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(143,163,199,0.4)' }}>
                  (Claim window closes; sender can refund after this)
                </p>
              </div>
            </div>
          </div>

          {/* Secret Security Configuration */}
          <div
            className="p-4 rounded-xl space-y-3"
            style={{ background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(143,163,199,0.12)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4" style={{ color: 'var(--silver-blue)' }} />
                <span
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'rgba(255,255,255,0.75)' }}
                >
                  Claim Secret
                </span>
              </div>
              {!useNoSecret && (
                <button
                  type="button"
                  onClick={() => setSecret(generateSecret())}
                  className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-70"
                  style={{ color: 'var(--silver-blue)' }}
                >
                  <RefreshCw className="w-3 h-3" /> Regenerate
                </button>
              )}
            </div>

            {!useNoSecret ? (
              <div>
                <p className="text-xs leading-relaxed mb-2" style={{ color: 'rgba(143,163,199,0.7)' }}>
                  A high-entropy 32-byte secret is generated in memory. The contract will only record its cryptographic hash commitment. The recipient will need this secret to claim the funds.
                </p>
                <div
                  className="p-2.5 rounded-lg font-mono text-[11px] break-all select-none"
                  style={{
                    background: 'rgba(10,15,30,0.7)',
                    border: '1px solid rgba(143,163,199,0.14)',
                    color: 'var(--copper)',
                  }}
                >
                  {secret.slice(0, 16)}••••••••••••••••••••••••••••••••••••••••{secret.slice(-8)}
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'rgba(143,163,199,0.4)' }}>
                  Commitment Hash:{' '}
                  <span className="font-mono" style={{ color: 'rgba(143,163,199,0.6)' }}>
                    {activeSecretHash.slice(0, 14)}...{activeSecretHash.slice(-8)}
                  </span>
                </p>
              </div>
            ) : (
              <div
                className="alert-warning p-3 rounded-lg text-xs"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--copper)' }} />
                  <div>
                    <strong className="font-semibold">Secret Check Disabled:</strong> Anyone with the recipient wallet's private key will be able to claim without a secret once unlocked.
                  </div>
                </div>
              </div>
            )}

            {/* Advanced toggle */}
            <div
              className="pt-2 flex items-center justify-between"
              style={{ borderTop: '1px solid rgba(143,163,199,0.08)' }}
            >
              <span className="text-xs" style={{ color: 'rgba(143,163,199,0.5)' }}>Advanced Option</span>
              <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
                <input
                  type="checkbox"
                  checked={useNoSecret}
                  onChange={(e) => setUseNoSecret(e.target.checked)}
                  autoComplete="off"
                  className="rounded border-silver-700 focus:ring-0"
                  style={{ accentColor: 'var(--copper)' }}
                />
                Disable Secret (Zero Hash)
              </label>
            </div>
          </div>

          {/* Action Button */}
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
                Please connect your wallet to create a transfer.
              </div>
            ) : chain?.id !== TARGET_CHAIN.id ? (
              <div
                className="alert-warning p-3 rounded-xl text-center text-xs flex items-center justify-center gap-1.5"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Switch to Sepolia network to create transfers.
              </div>
            ) : (
              <button
                type="submit"
                disabled={!isFormValid}
                className="btn-primary w-full py-3.5 px-4 text-sm"
              >
                Review &amp; Confirm Transfer
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {isReviewing && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(10,15,30,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="glass-card max-w-lg w-full p-6 space-y-5"
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div
                className="flex items-center justify-between pb-3"
                style={{ borderBottom: '1px solid rgba(143,163,199,0.1)' }}
              >
                <h3
                  className="text-lg font-serif font-bold flex items-center gap-2"
                  style={{ color: 'rgba(255,255,255,0.92)' }}
                >
                  <ShieldAlert className="w-5 h-5" style={{ color: 'var(--copper)' }} />
                  Confirm Time-Locked Escrow
                </h3>
                <button
                  onClick={() => setIsReviewing(false)}
                  className="text-sm transition-opacity hover:opacity-70"
                  style={{ color: 'rgba(143,163,199,0.6)' }}
                >
                  ✕
                </button>
              </div>

              {/* Full Recipient Address Display */}
              <div className="space-y-3 text-xs">
                <div
                  className="p-3 rounded-xl"
                  style={{ background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(143,163,199,0.14)' }}
                >
                  <span
                    className="uppercase font-semibold text-[10px]"
                    style={{ color: 'var(--silver-blue)' }}
                  >
                    Recipient (Full Address)
                  </span>
                  <p
                    className="font-mono text-sm break-all mt-1 select-all tracking-wider"
                    style={{ color: 'rgba(255,255,255,0.92)' }}
                  >
                    {(recipient.match(/.{1,4}/g) ?? [recipient]).join(' ')}
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: 'rgba(143,163,199,0.4)' }}>
                    Full 42-character address, shown in 4-character groups — compare it character by character with the recipient.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div
                    className="p-3 rounded-xl"
                    style={{ background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(143,163,199,0.14)' }}
                  >
                    <span className="uppercase font-semibold text-[10px]" style={{ color: 'var(--silver-blue)' }}>
                      Amount
                    </span>
                    <p className="text-base font-bold font-tabular mt-0.5" style={{ color: 'var(--copper)' }}>
                      {amountInput} {isEth ? 'ETH' : erc20Token?.symbol}
                    </p>
                  </div>
                  <div
                    className="p-3 rounded-xl"
                    style={{ background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(143,163,199,0.14)' }}
                  >
                    <span className="uppercase font-semibold text-[10px]" style={{ color: 'var(--silver-blue)' }}>
                      Cancel Window
                    </span>
                    <p className="text-base font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>
                      {formatDuration(activeDelaySeconds)}
                    </p>
                  </div>
                </div>

                <div
                  className="p-3 rounded-xl space-y-2"
                  style={{ background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(143,163,199,0.14)' }}
                >
                  <div>
                    <span className="text-[10px] uppercase font-semibold" style={{ color: 'var(--silver-blue)' }}>
                      Unlock Time (Your Local Time)
                    </span>
                    <p className="font-mono mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>
                      {formatLocalTimestamp(previewUnlockTimestamp)}
                    </p>
                  </div>
                  <div
                    className="pt-2"
                    style={{ borderTop: '1px solid rgba(143,163,199,0.08)' }}
                  >
                    <span className="text-[10px] uppercase font-semibold" style={{ color: 'var(--silver-blue)' }}>
                      Expiry Time (Your Local Time)
                    </span>
                    <p className="font-mono mt-0.5" style={{ color: 'var(--copper)' }}>
                      {formatLocalTimestamp(previewExpiryTimestamp)}
                    </p>
                  </div>
                </div>

                <div
                  className="p-3 rounded-xl"
                  style={{ background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(143,163,199,0.14)' }}
                >
                  <span className="text-[10px] uppercase font-semibold" style={{ color: 'var(--silver-blue)' }}>
                    Secret Protection Commitment
                  </span>
                  <p
                    className="font-mono text-[11px] mt-0.5 break-all"
                    style={{ color: 'rgba(143,163,199,0.6)' }}
                  >
                    {useNoSecret ? 'None (Zero Hash Disabled)' : activeSecretHash}
                  </p>
                </div>
              </div>

              {/* Double-check confirmation gate */}
              <div
                className="p-3 rounded-xl"
                style={{ background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(143,163,199,0.2)' }}
              >
                <label className="flex items-start gap-2.5 cursor-pointer text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  <input
                    type="checkbox"
                    checked={addressConfirmed}
                    onChange={(e) => setAddressConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded focus:ring-0"
                    style={{ accentColor: 'var(--copper)' }}
                  />
                  <span>
                    <strong className="font-semibold">I have double-checked the recipient address</strong>
                    <span className="block text-[11px] mt-0.5" style={{ color: 'var(--silver-blue)' }}>
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
                    className="btn-secondary w-full py-3 text-sm flex items-center justify-center gap-2"
                  >
                    {(isApprovePending || isApproveWaiting) && <RefreshCw className="w-4 h-4 animate-spin" />}
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
                      className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2"
                    >
                      {(isCreatePending || isCreateWaiting) && <RefreshCw className="w-4 h-4 animate-spin" />}
                      {isCreatePending
                        ? 'Confirm Transfer in Wallet...'
                        : isCreateWaiting
                        ? 'Locking Funds in Vault...'
                        : 'Confirm & Lock Funds'}
                    </button>
                    {!addressConfirmed && !(isCreatePending || isCreateWaiting) && (
                      <p className="text-[11px] text-center" style={{ color: 'var(--copper)' }}>
                        Tick the checkbox above to enable Confirm.
                      </p>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setIsReviewing(false)}
                  disabled={isCreatePending || isCreateWaiting || isApprovePending || isApproveWaiting}
                  className="w-full py-2 text-xs transition-opacity hover:opacity-80"
                  style={{ color: 'rgba(143,163,199,0.5)' }}
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
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(10,15,30,0.92)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="glass-card max-w-lg w-full p-6 space-y-5"
              style={{ borderColor: 'rgba(232,116,59,0.4)' }}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div className="text-center">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
                  style={{ background: 'rgba(232,116,59,0.1)', border: '1px solid rgba(232,116,59,0.3)' }}
                >
                  <Sparkles className="w-6 h-6" style={{ color: 'var(--copper)' }} />
                </div>
                <h2
                  className="text-xl font-serif font-bold"
                  style={{ color: 'rgba(255,255,255,0.92)' }}
                >
                  Transfer Successfully Locked!
                </h2>
                <p className="text-xs mt-1" style={{ color: 'var(--silver-blue)' }}>
                  Transfer ID:{' '}
                  <strong className="font-mono text-sm" style={{ color: 'rgba(255,255,255,0.92)' }}>
                    #{successTransferId.toString()}
                  </strong>
                </p>
              </div>

              {/* Warning Box */}
              <div className="alert-warning p-3.5 space-y-1">
                <div
                  className="flex items-center gap-1.5 font-bold text-xs"
                  style={{ color: 'var(--copper)' }}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Save This Secret Now (Shown Only Once)</span>
                </div>
                <p
                  className="leading-relaxed text-[11px] opacity-90"
                  style={{ color: 'var(--copper)' }}
                >
                  Share this secret with the recipient through a separate, private channel (e.g. Signal, Telegram, encrypted email). It is <strong>NOT</strong> stored anywhere, cannot be retrieved from on-chain logs or browser storage, and cannot be recovered if lost!
                </p>
              </div>

              {/* Secret Reveal with Copy */}
              <div className="space-y-1.5">
                <label
                  className="text-[11px] font-semibold uppercase"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                >
                  Claim Secret String
                </label>
                <div
                  className="flex items-center gap-2 p-3 rounded-xl"
                  style={{ background: 'rgba(10,15,30,0.7)', border: '1px solid rgba(143,163,199,0.16)' }}
                >
                  <input
                    type="text"
                    readOnly
                    value={revealedSecret}
                    className="w-full bg-transparent font-mono text-xs select-all focus:outline-none"
                    style={{ color: 'var(--copper)' }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(revealedSecret);
                      setCopiedSecret(true);
                      setTimeout(() => setCopiedSecret(false), 3000);
                    }}
                    className="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs shrink-0"
                  >
                    {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSecret ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Acknowledgment Checkbox */}
              <label
                className="flex items-start gap-2.5 p-3 rounded-xl cursor-pointer select-none"
                style={{ background: 'rgba(10,15,30,0.5)', border: '1px solid rgba(143,163,199,0.14)' }}
              >
                <input
                  type="checkbox"
                  checked={userAcknowledgedSave}
                  onChange={(e) => setUserAcknowledgedSave(e.target.checked)}
                  className="mt-0.5 rounded focus:ring-0"
                  style={{ accentColor: 'var(--copper)' }}
                />
                <span className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  I have securely copied and shared this secret. I understand it will be wiped from browser memory when I close this modal.
                </span>
              </label>

              {/* Done Button */}
              <button
                type="button"
                disabled={!userAcknowledgedSave}
                onClick={() => { resetForm(); }}
                className="btn-secondary w-full py-3 text-sm"
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
