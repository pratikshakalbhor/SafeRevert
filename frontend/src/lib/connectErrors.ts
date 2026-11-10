/**
 * Maps wallet-connection errors (wagmi / RainbowKit / EIP-1193) to a short,
 * human-readable toast. Reads no environment values and touches no contract
 * logic — it only inspects the error object it is given.
 */

export interface ConnectErrorInfo {
  title: string;
  message: string;
}

/** Pulls an EIP-1193 / RPC error code (`code: -32002`, `code: '4001'`, ...) out of an error. */
const numericCode = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number') return code;
  if (typeof code === 'string' && /^-?\d+$/.test(code.trim())) return Number(code.trim());
  return undefined;
};

/** Flattens name / message / shortMessage / details / cause into one searchable string. */
const errorText = (error: unknown): string => {
  if (error === null || error === undefined) return '';
  if (typeof error !== 'object') return String(error);

  const e = error as {
    name?: unknown;
    message?: unknown;
    shortMessage?: unknown;
    details?: unknown;
    cause?: unknown;
  };
  const parts = [e.name, e.message, e.shortMessage, e.details];
  // viem wraps the raw provider error one level deep (`cause`)
  if (typeof e.cause === 'object' && e.cause !== null) {
    const c = e.cause as { name?: unknown; message?: unknown; code?: unknown };
    parts.push(c.name, c.message);
  }
  return parts.filter((p): p is string => typeof p === 'string').join(' ');
};

/** Best human-readable message, preferring viem's `shortMessage`. */
const readableMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null) {
    const e = error as { shortMessage?: unknown; message?: unknown; details?: unknown };
    for (const candidate of [e.shortMessage, e.message, e.details]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  const text = String(error ?? '').trim();
  return text || 'Unknown error';
};

const truncate = (text: string, max = 220): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Converts a connect failure into a toast title + message.
 *
 * Explicitly handled:
 *  - `-32002` — a request is already pending in MetaMask
 *  - `4001` / `UserRejectedRequestError` — the user rejected the request
 *  - `ConnectorNotFoundError` / `ProviderNotFoundError` — no connector found
 */
export function describeConnectError(error: unknown): ConnectErrorInfo {
  const lower = errorText(error).toLowerCase();
  const code = numericCode(error);

  // -32002: MetaMask already has an unfinished `eth_requestAccounts`.
  if (code === -32002 || lower.includes('-32002') || lower.includes('already pending')) {
    return {
      title: 'Wallet request already pending',
      message:
        'MetaMask already has an unfinished connection request. Open the MetaMask extension, approve or reject the pending request, then try connecting again.',
    };
  }

  // 4001: the user declined the request.
  if (
    code === 4001 ||
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('action_rejected')
  ) {
    return {
      title: 'Connection rejected',
      message:
        'You rejected the connection request inside your wallet. Open MetaMask and approve the request to connect.',
    };
  }

  // No usable connector / injected provider.
  if (
    lower.includes('connector not found') ||
    lower.includes('provider not found') ||
    lower.includes('no connector')
  ) {
    return {
      title: 'Wallet connector not found',
      message:
        'No wallet connector was found. Unlock or reinstall your wallet extension, then retry — or choose Browser Wallet for a direct connection.',
    };
  }

  return {
    title: 'Connection failed',
    message: truncate(readableMessage(error)),
  };
}
