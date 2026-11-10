import type { PresetDelay, PresetExpiry } from './types';

export const MIN_DELAY_SECONDS = 60; // 1 minute
export const MAX_DELAY_SECONDS = 86400; // 24 hours
export const MAX_UINT64 = 18446744073709551615n;

export const PRESET_DELAYS: PresetDelay[] = [
  { label: '5 min', seconds: 5 * 60 },
  { label: '15 min', seconds: 15 * 60 },
  { label: '30 min', seconds: 30 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
];

export const PRESET_EXPIRIES: PresetExpiry[] = [
  { label: '1 hour after unlock', secondsAfterUnlock: 60 * 60 },
  { label: '24 hours after unlock', secondsAfterUnlock: 24 * 60 * 60 },
  { label: '7 days after unlock', secondsAfterUnlock: 7 * 24 * 60 * 60 },
];

/**
 * Validates a delay in seconds according to SafeRevertVault contract rules.
 */
export function validateDelay(delaySeconds: number): { valid: boolean; error?: string } {
  if (isNaN(delaySeconds) || delaySeconds < MIN_DELAY_SECONDS) {
    return { valid: false, error: 'Delay must be at least 1 minute (60 seconds)' };
  }
  if (delaySeconds > MAX_DELAY_SECONDS) {
    return { valid: false, error: 'Delay cannot exceed 24 hours (86,400 seconds)' };
  }
  return { valid: true };
}

/**
 * Computes unlock timestamp given current timestamp and delay.
 */
export function computeUnlockTime(nowSeconds: number, delaySeconds: number): number {
  return Math.floor(nowSeconds) + Math.floor(delaySeconds);
}

/**
 * Computes absolute expiry timestamp given unlockTime and expiry window duration.
 */
export function computeExpiryTime(unlockTime: number, expiryWindowSeconds: number): number {
  if (expiryWindowSeconds <= 0) {
    throw new Error('Expiry window duration must be greater than 0');
  }
  const expiry = Math.floor(unlockTime) + Math.floor(expiryWindowSeconds);
  if (BigInt(expiry) > MAX_UINT64) {
    throw new Error('Expiry timestamp exceeds maximum uint64');
  }
  return expiry;
}

/**
 * Validates that expiry is strictly greater than unlockTime and within uint64.
 */
export function validateExpiry(expiryTimestamp: number, unlockTimestamp: number): { valid: boolean; error?: string } {
  if (isNaN(expiryTimestamp) || isNaN(unlockTimestamp)) {
    return { valid: false, error: 'Invalid timestamp' };
  }
  if (expiryTimestamp <= unlockTimestamp) {
    return { valid: false, error: 'Expiry must be strictly after unlock time' };
  }
  if (BigInt(expiryTimestamp) > MAX_UINT64) {
    return { valid: false, error: 'Expiry exceeds uint64 limit' };
  }
  return { valid: true };
}

/**
 * Formats a unix timestamp (in seconds) into the user's local timezone.
 * Example: "Nov 9, 2026, 3:30:00 PM GMT+5:30"
 */
export function formatLocalTimestamp(timestampInSeconds: number | bigint): string {
  const ts = Number(timestampInSeconds);
  if (!ts || isNaN(ts)) return '—';
  const date = new Date(ts * 1000);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Formats duration in seconds into a clean human readable string (e.g. "15m", "1h 30m").
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (hours < 24) {
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Calculates countdown breakdown from now to target timestamp.
 */
export function getCountdown(
  targetTimestampSeconds: number | bigint,
  nowSeconds = Math.floor(Date.now() / 1000)
): { isPast: boolean; secondsRemaining: number; formatted: string } {
  const target = Number(targetTimestampSeconds);
  const diff = target - nowSeconds;

  if (diff <= 0) {
    return { isPast: true, secondsRemaining: 0, formatted: '0s' };
  }

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return {
    isPast: false,
    secondsRemaining: diff,
    formatted: parts.join(' '),
  };
}
