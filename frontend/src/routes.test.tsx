/**
 * @vitest-environment jsdom
 *
 * Routing tests: the right page per route, the wallet gate on protected
 * pages, and the friendly 404. Heavy wallet pages are stubbed — the unit
 * under test here is the route table, not page internals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from './routes';

/** Mutable connection state read by the wagmi mock below. */
const connection = vi.hoisted(() => ({ isConnected: false }));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    isConnected: connection.isConnected,
    address: connection.isConnected
      ? '0x1111111111111111111111111111111111111111'
      : undefined,
    chain: connection.isConnected ? { id: 11155111 } : undefined,
  }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  // Undefined client keeps useTransfers' query disabled — no RPC in tests.
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
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
  }),
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

// Heavy wallet pages are replaced with testids: routing, not page internals,
// is what these tests verify.
vi.mock('./pages/SendPage', () => ({
  SendPage: () => <div data-testid="page-send" />,
}));
vi.mock('./pages/TransfersPage', () => ({
  TransfersPage: () => <div data-testid="page-transfers" />,
}));
vi.mock('./pages/ClaimPage', () => ({
  ClaimPage: ({ initialTransferId }: { initialTransferId?: bigint | null }) => (
    <div data-testid="page-claim">
      {initialTransferId !== null && initialTransferId !== undefined
        ? initialTransferId.toString()
        : ''}
    </div>
  ),
}));
vi.mock('./pages/DashboardPage', () => ({
  DashboardPage: () => <div data-testid="page-dashboard" />,
}));
vi.mock('./pages/TransferDetailPage', () => ({
  TransferDetailPage: () => <div data-testid="page-detail" />,
}));

function renderRoute(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SafeRevert routing', () => {
  beforeEach(() => {
    connection.isConnected = false;
  });

  afterEach(() => {
    cleanup();
  });

  // --- Public pages --------------------------------------------------------

  it('renders Home at /', () => {
    renderRoute('/');
    expect(screen.getByRole('heading', { name: /how it works/i })).toBeTruthy();
    // Home is public: no wallet gate.
    expect(screen.queryByText(/connect your wallet to continue/i)).toBeNull();
  });

  it('renders Security at /security without a wallet', () => {
    renderRoute('/security');
    expect(
      screen.getByRole('heading', { name: /threat model/i })
    ).toBeTruthy();
    expect(screen.queryByText(/connect your wallet to continue/i)).toBeNull();
  });

  it('renders the friendly 404 for an unknown path', () => {
    renderRoute('/definitely-not-a-page');
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to home/i })).toBeTruthy();
    expect(screen.queryByTestId('page-send')).toBeNull();
  });

  // --- Protected pages, disconnected --------------------------------------

  it.each([
    ['/send', 'page-send'],
    ['/dashboard', 'page-dashboard'],
    ['/transfers', 'page-transfers'],
    ['/transfers/7', 'page-detail'],
    ['/claim', 'page-claim'],
  ])(
    'shows the connect screen instead of %s when no wallet is connected',
    (path, pageTestId) => {
      renderRoute(path);
      expect(
        screen.getByText('Connect your wallet to continue')
      ).toBeTruthy();
      expect(screen.queryByTestId(pageTestId)).toBeNull();
    }
  );

  // --- Protected pages, connected -----------------------------------------

  it('renders the Send page at /send when connected', () => {
    connection.isConnected = true;
    renderRoute('/send');
    expect(screen.getByTestId('page-send')).toBeTruthy();
    expect(screen.queryByText(/connect your wallet to continue/i)).toBeNull();
  });

  it('renders the Dashboard at /dashboard when connected', () => {
    connection.isConnected = true;
    renderRoute('/dashboard');
    expect(screen.getByTestId('page-dashboard')).toBeTruthy();
  });

  it('renders the transfer detail at /transfers/:id when connected', () => {
    connection.isConnected = true;
    renderRoute('/transfers/7');
    expect(screen.getByTestId('page-detail')).toBeTruthy();
  });

  it('pre-fills the claim page from /claim/:id (id only, never a secret)', () => {
    connection.isConnected = true;
    renderRoute('/claim/42');
    expect(screen.getByTestId('page-claim').textContent).toBe('42');
  });

  it('renders the claim page without an id at /claim', () => {
    connection.isConnected = true;
    renderRoute('/claim');
    expect(screen.getByTestId('page-claim').textContent).toBe('');
  });

  // --- Shared layout -------------------------------------------------------

  it('renders the navbar links on public pages', () => {
    renderRoute('/');
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /my transfers/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Security' })).toBeTruthy();
    expect(screen.getByTestId('wallet-button')).toBeTruthy();
  });
});
