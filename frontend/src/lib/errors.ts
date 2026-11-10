import {
  decodeErrorResult,
  BaseError,
  ContractFunctionExecutionError,
  type Hex,
} from 'viem';
import { safeRevertVaultAbi } from './abi';
import { STATE_LABELS, TransferState } from './types';
import { formatLocalTimestamp } from './time';

/**
 * Decodes on-chain custom errors from SafeRevertVault and returns human-readable error messages.
 */
export function decodeContractError(error: unknown): string {
  if (!error) return 'An unknown error occurred.';

  // Check for user rejection in wallet
  const rawMsg = error instanceof Error ? error.message : String(error);
  if (
    rawMsg.includes('User rejected') ||
    rawMsg.includes('User denied') ||
    rawMsg.includes('user rejected')
  ) {
    return 'Transaction rejected by user in wallet.';
  }

  // Attempt to extract revert data from Viem BaseError
  let errorData: Hex | undefined;

  if (error instanceof BaseError) {
    const revertError = error.walk(
      (err) => 'data' in (err as { data?: unknown })
    ) as { data?: Hex } | null;

    if (revertError && typeof revertError.data === 'string' && revertError.data.startsWith('0x')) {
      errorData = revertError.data as Hex;
    }
  }

  // If no error data found through walk, try regex for hex in message
  if (!errorData && typeof rawMsg === 'string') {
    const match = rawMsg.match(/0x[a-fA-F0-9]{8,}/);
    if (match) {
      errorData = match[0] as Hex;
    }
  }

  if (errorData && errorData.length >= 10) {
    try {
      const decoded = decodeErrorResult({
        abi: safeRevertVaultAbi,
        data: errorData,
      }) as { errorName: string; args?: readonly unknown[] };

      switch (decoded.errorName) {
        case 'InvalidRecipient':
          return 'Invalid Recipient: Recipient cannot be the zero address or the vault contract address.';
        case 'InvalidAmount':
          return 'Invalid Amount: Transfer amount must be greater than zero and received by the vault.';
        case 'InvalidDelay': {
          const delay = decoded.args?.[0];
          return `Invalid Delay: Delay (${delay ? String(delay) + 's' : ''}) must be between 1 minute (60s) and 24 hours (86,400s).`;
        }
        case 'InvalidExpiry': {
          const expiry = decoded.args?.[0];
          const unlockTime = decoded.args?.[1];
          return `Invalid Expiry: Expiry (${expiry ? formatLocalTimestamp(Number(expiry)) : ''}) must be strictly after unlock time (${unlockTime ? formatLocalTimestamp(Number(unlockTime)) : ''}) and fit within uint64.`;
        }
        case 'MsgValueMismatch':
          return 'Value Mismatch: ETH sent (msg.value) must equal the transfer amount for native ETH, and must be 0 for ERC-20 transfers.';
        case 'TransferNotFound': {
          const id = decoded.args?.[0];
          return `Transfer Not Found: Transfer #${id !== undefined ? String(id) : ''} does not exist in the vault.`;
        }
        case 'NotPending': {
          const id = decoded.args?.[0];
          const state = Number(decoded.args?.[1]) as TransferState;
          const stateLabel = STATE_LABELS[state] || String(state);
          return `Transfer #${id !== undefined ? String(id) : ''} is not pending. Current state: ${stateLabel}.`;
        }
        case 'NotSender':
          return 'Unauthorized: Only the original sender is permitted to cancel or refund this transfer.';
        case 'NotRecipient':
          return 'Unauthorized: Connected wallet is not the designated recipient of this transfer.';
        case 'TooEarly': {
          const unlockTime = decoded.args?.[1];
          return `Too Early: Action cannot be performed yet. Claim window opens at ${unlockTime ? formatLocalTimestamp(Number(unlockTime)) : 'unlock time'}, or cancel window has already passed.`;
        }
        case 'Expired': {
          const expiry = decoded.args?.[1];
          return `Expired: The claim window closed at ${expiry ? formatLocalTimestamp(Number(expiry)) : 'expiry'}. Recipient can no longer claim; sender can now refund.`;
        }
        case 'InvalidSecret':
          return 'Invalid Secret: The provided secret does not match the on-chain secret hash commitment.';
        case 'EthTransferFailed':
          return 'ETH Transfer Failed: Destination address rejected the ETH payout (e.g. non-payable smart contract).';
        case 'SafeERC20FailedOperation':
          return 'ERC-20 Operation Failed: Token transfer failed. Check token balance and vault allowance.';
        case 'ReentrancyGuardReentrantCall':
          return 'Reentrancy detected: Call interrupted by reentrancy guard.';
        default:
          return `Contract reverted with error: ${decoded.errorName}`;
      }
    } catch {
      // Could not decode with safeRevertVaultAbi, fall through
    }
  }

  // Handle common RPC error substrings
  if (rawMsg.includes('insufficient funds')) {
    return 'Insufficient funds for transfer or gas fees.';
  }
  if (rawMsg.includes('connector not connected') || rawMsg.includes('wallet not connected')) {
    return 'Wallet is not connected. Please connect your wallet first.';
  }

  if (error instanceof ContractFunctionExecutionError) {
    return error.shortMessage || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }

  return 'Transaction failed. Please check parameters and try again.';
}
