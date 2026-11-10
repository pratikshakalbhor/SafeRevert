/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

type EnvFlags = { vault: boolean; walletConnect: boolean };

/**
 * Mounts NetworkBanner with stubbed wagmi hooks and explicit config flags, so
 * both the "missing env" and "fully configured" branches are exercised without
 * reading any real .env values.
 */
async function renderBanner(flags: EnvFlags) {
  vi.doMock('wagmi', () => ({
    useAccount: () => ({ isConnected: false, chain: undefined }),
    useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  }));
  vi.doMock('../lib/config', () => ({
    TARGET_CHAIN: { id: 11155111, name: 'Sepolia' },
    IS_VAULT_CONFIGURED: flags.vault,
    IS_WALLETCONNECT_CONFIGURED: flags.walletConnect,
  }));

  const { NetworkBanner } = await import('./NetworkBanner');
  return render(<NetworkBanner />);
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock('wagmi');
  vi.doUnmock('../lib/config');
});

describe('NetworkBanner render smoke', () => {
  it('mounts without throwing when the env flags are missing', async () => {
    const { container } = await renderBanner({
      vault: false,
      walletConnect: false,
    });

    expect(container.firstChild).toBeTruthy();
    expect(screen.getByText(/Environment not fully configured/)).toBeTruthy();
    expect(screen.getByText('VITE_VAULT_ADDRESS')).toBeTruthy();
    expect(screen.getByText('VITE_WALLETCONNECT_PROJECT_ID')).toBeTruthy();
  });

  it('mounts without throwing when every env flag is configured', async () => {
    const { container } = await renderBanner({
      vault: true,
      walletConnect: true,
    });

    expect(container.firstChild).toBeTruthy();
    expect(screen.queryByText(/Environment not fully configured/)).toBeNull();
    expect(screen.queryByText('VITE_VAULT_ADDRESS')).toBeNull();
  });
});
