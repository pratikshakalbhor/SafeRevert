import { isAddress, type Address, http } from 'viem';
import { sepolia } from 'wagmi/chains';
import { createConnector, type CreateConnectorFn } from 'wagmi';
import { injected } from 'wagmi/connectors';
import {
  getDefaultConfig,
  getDefaultWallets,
} from '@rainbow-me/rainbowkit';
import type {
  Wallet,
  WalletDetailsParams,
  WalletList,
} from '@rainbow-me/rainbowkit';

// Read environment variables (values are never displayed in the UI)
export const RAW_VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS || '';
export const SEPOLIA_RPC_URL =
  import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';

// WalletConnect project id. RainbowKit *throws at startup* when this is empty
// (WalletConnect v2 requires a project id), so a placeholder keeps the app
// bootable while the banner below tells the user to set their own value.
const RAW_WALLETCONNECT_PROJECT_ID = (
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || ''
).trim();
const FALLBACK_WALLETCONNECT_PROJECT_ID = '3fcc6bba2d1de9622da67d1e40643047';
export const WALLETCONNECT_PROJECT_ID =
  RAW_WALLETCONNECT_PROJECT_ID || FALLBACK_WALLETCONNECT_PROJECT_ID;

// WalletConnect presence flag used by the configuration banner (value itself
// is never shown).

// Validate vault address
export const VAULT_ADDRESS: Address = isAddress(RAW_VAULT_ADDRESS)
  ? (RAW_VAULT_ADDRESS as Address)
  : ('0x0000000000000000000000000000000000000000' as Address);

export const IS_VAULT_CONFIGURED =
  isAddress(RAW_VAULT_ADDRESS) &&
  RAW_VAULT_ADDRESS.toLowerCase() !== '0x0000000000000000000000000000000000000000';

export const IS_WALLETCONNECT_CONFIGURED =
  RAW_WALLETCONNECT_PROJECT_ID.length > 0;

export const TARGET_CHAIN = sepolia;

const hasInjectedProvider = (): boolean =>
  typeof window !== 'undefined' &&
  typeof (window as Window & { ethereum?: unknown }).ethereum !== 'undefined';

// Generic 48x48 wallet glyph (data URI) so the entry has a valid RainbowKit icon.
const INJECTED_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%233b82f6'/%3E%3Cpath d='M11 17h26a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3z' fill='%23ffffff'/%3E%3Ccircle cx='34' cy='25.5' r='2.5' fill='%233b82f6'/%3E%3C/svg%3E";

/**
 * Direct connection to the browser-extension provider (`window.ethereum`).
 *
 * RainbowKit's default list has no `injectedWallet`: it only offers MetaMask
 * through its own detector, and when `window.ethereum` is not detected as
 * MetaMask it silently routes that entry through WalletConnect instead — which
 * then fails unless a valid project id is configured. This wallet always
 * connects straight to the injected provider (MetaMask, Brave, Rabby, ...).
 *
 * We build it locally because `@rainbow-me/rainbowkit/wallets` bundles every
 * wallet and fails to compile against wagmi v3 (it imports `gemini`, which
 * wagmi v3 no longer exports).
 */
const browserWallet = (): Wallet => ({
  id: 'injected',
  name: 'Browser Wallet',
  iconUrl: INJECTED_ICON,
  iconBackground: '#ffffff',
  installed: hasInjectedProvider(),
  // Only listed when an extension provider actually exists.
  hidden: () => !hasInjectedProvider(),
  createConnector: (walletDetails: WalletDetailsParams): CreateConnectorFn =>
    createConnector((config) => ({
      ...injected()(config),
      ...walletDetails,
    })),
});

// RainbowKit's built-in wallet creators (MetaMask, Rainbow, Safe, ...), obtained
// without importing the broken `/wallets` entry point.
const defaultWalletList: WalletList = getDefaultWallets().wallets;

const walletList: WalletList = [
  {
    groupName: 'Popular',
    wallets: [browserWallet, ...defaultWalletList[0].wallets],
  },
];

// Configure Wagmi & RainbowKit
export const wagmiConfig = getDefaultConfig({
  appName: 'SafeRevert Escrow',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(SEPOLIA_RPC_URL),
  },
  wallets: walletList,
  ssr: false,
});
