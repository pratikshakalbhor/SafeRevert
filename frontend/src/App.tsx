import React, { useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { wagmiConfig } from './lib/config';
import { ToastProvider } from './components/ToastContext';
import { NetworkBanner } from './components/NetworkBanner';
import { Navbar, type NavTab } from './components/Navbar';
import { SendPage } from './pages/SendPage';
import { TransfersPage } from './pages/TransfersPage';
import { ClaimPage } from './pages/ClaimPage';
import { useTransfers } from './hooks/useTransfers';
import { useConnectErrorToast } from './hooks/useConnectErrorToast';
import { ConnectHelpHint } from './components/ConnectHelpHint';
import {
  pageVariants,
  pageVariantsReduced,
  pickVariants,
} from './lib/motion';

const queryClient = new QueryClient();

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary: a crash anywhere below it renders a friendly
 * fallback (instead of a blank page) and logs the error + component stack to
 * the console for debugging.
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('SafeRevert: unhandled UI error', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 px-6 text-center"
        >
          <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl p-8 shadow-2xl space-y-4">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 text-2xl">
              !
            </div>
            <h1 className="text-xl font-bold text-white">Something went wrong</h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              The app hit an unexpected error and could not continue. Your wallet
              and funds are unaffected — nothing was sent.
            </p>
            {this.state.error && (
              <p className="text-[11px] font-mono text-slate-500 break-all text-left bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={this.handleReload}
              className="w-full py-3 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              Reload the app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const MainContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('id')) return 'claim';
    }
    return 'send';
  });

  const [claimTransferId, setClaimTransferId] = useState<bigint | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const idParam = params.get('id');
      if (idParam) {
        const parsed = parseInt(idParam, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          return BigInt(parsed);
        }
      }
    }
    return null;
  });

  // Hook into transfers count
  const { transfers } = useTransfers();

  // Surface wagmi connect failures (pending request, rejection, missing
  // connector) as readable toasts instead of failing silently.
  useConnectErrorToast();

  const reduced = useReducedMotion() ?? false;
  const variants = pickVariants(reduced, pageVariants, pageVariantsReduced);

  const handleNavigateToClaim = (id: bigint) => {
    setClaimTransferId(id);
    setActiveTab('claim');
  };

  const handleTransferCreated = (_id: bigint) => {
    // Keep user on Send page so they can copy and review the secret in the one-time modal
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Network & Configuration Banner */}
      <NetworkBanner />

      {/* Troubleshooting hint shown while the Connect Wallet modal is open */}
      <ConnectHelpHint />

      {/* Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        myTransfersCount={transfers.length}
      />

      {/* Main Page Body */}
      <main className="flex-1 w-full pb-16 overflow-x-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {activeTab === 'send' && (
            <motion.div
              key="send"
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <SendPage onTransferCreated={handleTransferCreated} />
            </motion.div>
          )}

          {activeTab === 'transfers' && (
            <motion.div
              key="transfers"
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <TransfersPage onNavigateToClaim={handleNavigateToClaim} />
            </motion.div>
          )}

          {activeTab === 'claim' && (
            <motion.div
              key="claim"
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ClaimPage initialTransferId={claimTransferId} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/60 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>
            SafeRevert &middot; Time-Locked Transfer Escrow on Ethereum Sepolia
          </p>
          <p className="text-[11px] text-slate-600">
            Never stores private keys or secrets. Secret strings live only in component memory.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            theme={darkTheme({
              accentColor: '#4f46e5',
              accentColorForeground: 'white',
              borderRadius: 'medium',
              fontStack: 'system',
            })}
          >
            <ToastProvider>
              <MainContent />
            </ToastProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  );
}
