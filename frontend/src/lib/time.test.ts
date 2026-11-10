import { describe, it, expect } from 'vitest';
import {
  computeUnlockTime,
  computeExpiryTime,
  validateDelay,
  validateExpiry,
  formatDuration,
  getCountdown,
  MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
} from './time';

describe('time helpers', () => {
  it('validates delay according to contract rules (1 min to 24 hours)', () => {
    expect(validateDelay(59).valid).toBe(false);
    expect(validateDelay(MIN_DELAY_SECONDS).valid).toBe(true);
    expect(validateDelay(3600).valid).toBe(true);
    expect(validateDelay(MAX_DELAY_SECONDS).valid).toBe(true);
    expect(validateDelay(MAX_DELAY_SECONDS + 1).valid).toBe(false);
  });

  it('computes unlock time accurately', () => {
    const now = 1700000000;
    const delay = 3600; // 1 hour
    expect(computeUnlockTime(now, delay)).toBe(1700003600);
  });

  it('computes and validates absolute expiry timestamp', () => {
    const unlockTime = 1700003600;
    const expiryWindow = 86400; // 24 hours
    const expiry = computeExpiryTime(unlockTime, expiryWindow);

    expect(expiry).toBe(1700090000);
    expect(expiry).toBeGreaterThan(unlockTime);

    // Validate valid expiry
    expect(validateExpiry(expiry, unlockTime).valid).toBe(true);

    // Reject expiry <= unlockTime
    expect(validateExpiry(unlockTime, unlockTime).valid).toBe(false);
    expect(validateExpiry(unlockTime - 10, unlockTime).valid).toBe(false);
  });

  it('formats durations cleanly', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(300)).toBe('5m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(86400)).toBe('1d');
    expect(formatDuration(90000)).toBe('1d 1h');
  });

  it('calculates countdown accurately', () => {
    const now = 1000;
    const future = 1000 + 3665; // 1h 1m 5s
    const countdown = getCountdown(future, now);

    expect(countdown.isPast).toBe(false);
    expect(countdown.secondsRemaining).toBe(3665);
    expect(countdown.formatted).toBe('1h 1m 5s');

    const past = getCountdown(999, now);
    expect(past.isPast).toBe(true);
    expect(past.secondsRemaining).toBe(0);
  });
});
