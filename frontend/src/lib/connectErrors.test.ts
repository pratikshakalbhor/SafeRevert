import { describe, it, expect } from 'vitest';
import { describeConnectError } from './connectErrors';

describe('describeConnectError', () => {
  it('maps error code -32002 (request already pending)', () => {
    const error = Object.assign(new Error('MetaMask already pending request'), {
      code: -32002,
    });
    const { title, message } = describeConnectError(error);
    expect(title).toBe('Wallet request already pending');
    expect(message).toContain('Open the MetaMask extension');
    expect(message).toContain('approve or reject the pending request');
  });

  it('maps -32002 mentioned only in the message', () => {
    const { title } = describeConnectError(new Error('-32002: request already pending'));
    expect(title).toBe('Wallet request already pending');
  });

  it('maps user rejection code 4001', () => {
    const error = Object.assign(new Error('User rejected the request.'), { code: 4001 });
    const { title, message } = describeConnectError(error);
    expect(title).toBe('Connection rejected');
    expect(message).toContain('approve the request');
  });

  it('maps UserRejectedRequestError by name/message without a code', () => {
    const error = Object.assign(new Error('User rejected the request.'), {
      name: 'UserRejectedRequestError',
    });
    expect(describeConnectError(error).title).toBe('Connection rejected');
  });

  it('maps ConnectorNotFoundError', () => {
    const error = Object.assign(new Error('Connector not found.'), {
      name: 'ConnectorNotFoundError',
    });
    const { title, message } = describeConnectError(error);
    expect(title).toBe('Wallet connector not found');
    expect(message).toContain('Browser Wallet');
  });

  it('maps ProviderNotFoundError (injected wallet missing)', () => {
    const error = Object.assign(new Error('Provider not found.'), {
      name: 'ProviderNotFoundError',
    });
    expect(describeConnectError(error).title).toBe('Wallet connector not found');
  });

  it('falls back to a readable message for unknown errors', () => {
    const { title, message } = describeConnectError(new Error('boom'));
    expect(title).toBe('Connection failed');
    expect(message).toBe('boom');
  });

  it('truncates very long messages', () => {
    const { message } = describeConnectError(new Error('x'.repeat(500)));
    expect(message.length).toBeLessThanOrEqual(220);
    expect(message.endsWith('…')).toBe(true);
  });
});
