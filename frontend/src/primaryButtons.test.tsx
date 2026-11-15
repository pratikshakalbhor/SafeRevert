/**
 * @vitest-environment jsdom
 *
 * Primary-button glow consistency.
 *
 * The torch light is defined ONCE in index.css (--btn-glow-alpha /
 * --btn-beam-alpha, applied by .btn-primary only), so every button that is
 * visually primary (copper-filled) must carry the `btn-primary` class —
 * never an inline copper background and never a copied box-shadow.
 *
 * Each page is rendered for real (wallet, RPC and vault mocked) and checked
 * two ways:
 *   1. a manifest of known primary controls per page (keyed by accessible
 *      name — the "aria-label list" approach) must render with the class;
 *   2. a sweep asserts no rendered control is copper-filled inline or
 *      carries an inline copper box-shadow without btn-primary.
 * Secondary (.btn-secondary) and destructive (.btn-destructive) controls are
 * asserted NOT to be primary — they intentionally have no glow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from './routes';
import { ToastProvider } from './components/ToastContext';
import { useTransfers } from './hooks/useTransfers';
import { NATIVE_TOKEN_ADDRESS, type TransferRecord } from './lib/types';

/** Mutable connection state read by the wagmi mock below. */
const connection = vi.hoisted(() => ({ isConnected: true }));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    isConnected: connection.isConnected,
    address: connection.isConnected
      ? '0x1111111111111111111111111111111111111111'
      : undefined,
    chain: connection.isConnected ? { id: 11155111, name: 'Sepolia' } : undefined,
  }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  usePublicClient: () => undefined,
  useReadContract: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useReadContracts: () => ({ data: undefined, isLoading: false }),
  useWriteContract: () => ({
    writeContract: vi.fn(),
    data: undefined,
    isPending: false,
    error: null,
  }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
  useBalance: () => ({ data: undefined }),
  useConnect: () => ({ connect: vi.fn(), isPending: false, error: null }),
}));

vi.mock('@rainbow-me/rainbowkit', () => ({
  ConnectButton: () => <div data-testid="wallet-button" />,
  useConnectModal: () => ({
    openConnectModal: vi.fn(),
    connectModalOpen: false,
  }),
}));

// Config stub: no .env values are read, and nothing is "configured".
vi.mock('./lib/config', () => ({
  RAW_VAULT_ADDRESS: '',
  SEPOLIA_RPC_URL: 'https://example.invalid',
  WALLETCONNECT_PROJECT_ID: '',
  VAULT_ADDRESS: '0x0000000000000000000000000000000000000000',
  IS_VAULT_CONFIGURED: false,
  IS_WALLETCONNECT_CONFIGURED: false,
  TARGET_CHAIN: { id: 11155111, name: 'Sepolia' },
  wagmiConfig: {},
}));

// The transfer list is fixture-driven: no RPC in tests.
vi.mock('./hooks/useTransfers', () => ({ useTransfers: vi.fn() }));

const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

function transfersResult(transfers: TransferRecord[]) {
  return {
    transfers,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as ReturnType<typeof useTransfers>;
}

/**
 * Three pending transfers so every My Transfers action row renders:
 *  - #0 sender, past expiry        → Refund            (primary)
 *  - #1 recipient, in claim window → Claim Now         (primary)
 *  - #2 sender, before unlock      → Cancel & Reclaim  (destructive)
 */
function makeFixtures(): TransferRecord[] {
  return [
    {
      id: 0n,
      sender: ME,
      recipient: OTHER,
      token: NATIVE_TOKEN_ADDRESS,
      amount: 10n ** 16n,
      unlockTime: nowSec() - 3600n,
      expiry: nowSec() - 60n,
      secretHash: '0x00',
      state: 0,
      tokenSymbol: 'ETH',
      tokenDecimals: 18,
    },
    {
      id: 1n,
      sender: OTHER,
      recipient: ME,
      token: NATIVE_TOKEN_ADDRESS,
      amount: 5n * 10n ** 15n,
      unlockTime: nowSec() - 60n,
      expiry: nowSec() + 3600n,
      secretHash: '0x00',
      state: 0,
      tokenSymbol: 'ETH',
      tokenDecimals: 18,
    },
    {
      id: 2n,
      sender: ME,
      recipient: OTHER,
      token: NATIVE_TOKEN_ADDRESS,
      amount: 10n ** 15n,
      unlockTime: nowSec() + 3600n,
      expiry: nowSec() + 7200n,
      secretHash: '0x00',
      state: 0,
      tokenSymbol: 'ETH',
      tokenDecimals: 18,
    },
  ];
}

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** True when an inline style paints a FULL (opaque) brand-copper surface. */
function isFullCopperFill(value: string): boolean {
  const v = value.toLowerCase();
  if (v.includes('var(--copper)') || v.includes('#e8743b')) return true;
  if (/\brgba?\(\s*232\s*,\s*116\s*,\s*59\s*\)/.test(v)) return true; // rgb() = opaque
  const m = v.match(/rgba\(\s*232\s*,\s*116\s*,\s*59\s*,\s*([0-9.]+)\s*\)/);
  if (m) return Number(m[1]) >= 0.85; // a tint (0.06–0.18) is not a fill
  return false;
}

const COPPER_SHADOW = /232,\s*116,\s*59|#E8743B|var\(--copper\)/i;

type PageCase = {
  label: string;
  path: string;
  connected: boolean;
  fixtures?: boolean;
};

type PrimaryCase = PageCase & {
  role: 'button' | 'link';
  name: string;
};

/** Known primary controls — every one must carry the shared glow class. */
const PRIMARY_CASES: PrimaryCase[] = [
  { label: 'Home hero — Connect Wallet', path: '/', connected: false, role: 'button', name: 'Connect Wallet' },
  { label: 'Home hero — Go to Dashboard', path: '/', connected: true, role: 'link', name: 'Go to Dashboard' },
  { label: 'Wallet gate — Connect Wallet', path: '/dashboard', connected: false, role: 'button', name: 'Connect Wallet' },
  { label: 'Dashboard empty state — Create a transfer', path: '/dashboard', connected: true, role: 'link', name: 'Create a transfer' },
  { label: 'Send — Review & Confirm Transfer', path: '/send', connected: true, role: 'button', name: 'Review & Confirm Transfer' },
  { label: 'Send — active asset toggle', path: '/send', connected: true, role: 'button', name: 'ETH (Native)' },
  { label: 'My Transfers — Refund', path: '/transfers', connected: true, fixtures: true, role: 'button', name: 'Refund' },
  { label: 'My Transfers — Claim Now', path: '/transfers', connected: true, fixtures: true, role: 'button', name: 'Claim Now' },
  { label: 'Transfer detail — Back to my transfers', path: '/transfers/7', connected: true, role: 'link', name: 'Back to my transfers' },
  { label: 'Claim — Lookup', path: '/claim', connected: true, role: 'button', name: 'Lookup' },
  { label: '404 — Back to home', path: '/definitely-not-a-page', connected: false, role: 'link', name: 'Back to home' },
];

/** Controls that must NOT be primary (secondary / destructive / text links). */
const NON_PRIMARY_CASES: PrimaryCase[] = [
  { label: 'Home — secondary CTA', path: '/', connected: true, role: 'link', name: 'Create a transfer' },
  { label: 'My Transfers — destructive Cancel', path: '/transfers', connected: true, fixtures: true, role: 'button', name: 'Cancel & Reclaim Funds' },
  { label: 'My Transfers — Details link', path: '/transfers', connected: true, fixtures: true, role: 'link', name: 'Details' },
  { label: 'Transfer detail — secondary Retry', path: '/transfers/7', connected: true, role: 'button', name: 'Retry' },
];

const SWEEP_CASES: PageCase[] = [
  { label: 'home disconnected', path: '/', connected: false },
  { label: 'home connected', path: '/', connected: true },
  { label: 'dashboard', path: '/dashboard', connected: true },
  { label: 'wallet gate', path: '/dashboard', connected: false },
  { label: 'send', path: '/send', connected: true },
  { label: 'my transfers', path: '/transfers', connected: true, fixtures: true },
  { label: 'transfer detail', path: '/transfers/7', connected: true },
  { label: 'claim', path: '/claim', connected: true },
  { label: 'security', path: '/security', connected: true },
  { label: '404', path: '/no-such-page', connected: false },
];

function setup(c: PageCase) {
  connection.isConnected = c.connected;
  vi.mocked(useTransfers).mockReturnValue(
    transfersResult(c.fixtures ? makeFixtures() : []),
  );
  return renderAt(c.path);
}

describe('primary buttons carry the shared glow class', () => {
  beforeEach(() => {
    connection.isConnected = true;
    vi.mocked(useTransfers).mockReturnValue(transfersResult([]));
  });

  afterEach(() => {
    cleanup();
  });

  it.each(PRIMARY_CASES)('$label', ({ role, name, ...page }: PrimaryCase) => {
    setup(page);
    const el = screen.getByRole(role, { name }) as HTMLElement;
    expect(el.className).toContain('btn-primary');
  });

  it.each(NON_PRIMARY_CASES)('$label — is not primary', ({ role, name, ...page }: PrimaryCase) => {
    setup(page);
    // getAllByRole: e.g. every card renders its own "Details" link.
    const els = screen.getAllByRole(role, { name }) as HTMLElement[];
    expect(els.length).toBeGreaterThan(0);
    for (const el of els) {
      expect(el.className).not.toContain('btn-primary');
    }
  });

  it('never leaves a copper-filled or copper-glowing control without btn-primary', () => {
    for (const page of SWEEP_CASES) {
      const { container } = setup(page);
      const controls = Array.from(
        container.querySelectorAll<HTMLElement>('button, a, [role="button"]'),
      );
      expect(controls.length, `${page.label}: no controls rendered`).toBeGreaterThan(0);

      for (const el of controls) {
        const inlineBg = `${el.style.background} ${el.style.backgroundColor}`;
        const inlineGlow = el.style.boxShadow;
        const filled = isFullCopperFill(inlineBg);
        const glowing = COPPER_SHADOW.test(inlineGlow);
        if (filled || glowing) {
          expect(
            el.className,
            `${page.label}: "${el.textContent?.trim()}" is copper-filled but missing btn-primary`,
          ).toContain('btn-primary');
        }
      }
      cleanup();
    }
  });

  it('does not put an inline background or copied shadow on primary buttons', () => {
    // The glow must come from .btn-primary (driven by --btn-glow-alpha /
    // --btn-beam-alpha in index.css) — never from component markup.
    for (const page of SWEEP_CASES) {
      const { container } = setup(page);
      for (const el of Array.from(
        container.querySelectorAll<HTMLElement>('.btn-primary'),
      )) {
        expect(el.style.background, `${page.label}: inline background`).toBe('');
        expect(el.style.backgroundColor, `${page.label}: inline background-color`).toBe('');
        expect(el.style.boxShadow, `${page.label}: inline box-shadow`).toBe('');
      }
      cleanup();
    }
  });
});
