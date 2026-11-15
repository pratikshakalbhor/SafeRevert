import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from './lib/config';
import { ToastProvider } from './components/ToastContext';
import { useConnectErrorToast } from './hooks/useConnectErrorToast';
import { AppRoutes } from './routes';
import { AlertTriangle } from 'lucide-react';

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
          className="min-h-screen flex flex-col items-center justify-center sr-bg px-6 text-center"
        >
          <div className="max-w-md w-full glass-card p-8 space-y-4">
            <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center alert-warning">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-serif font-bold" style={{ color: 'rgba(255,255,255,0.92)' }}>
              Something went wrong
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--silver-blue)' }}>
              The app hit an unexpected error and could not continue. Your wallet
              and funds are unaffected — nothing was sent.
            </p>
            {this.state.error && (
              <p className="text-[11px] font-mono break-all text-left p-2.5 rounded-lg"
                style={{ background: 'rgba(10,15,30,0.8)', border: '1px solid rgba(143,163,199,0.16)', color: 'rgba(143,163,199,0.7)' }}>
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={this.handleReload}
              className="btn-primary w-full py-3 text-sm"
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

/**
 * Thin bridge: subscribes to wallet-connect failures and renders the route
 * table. Layout, navbar, banner and footer live in AppLayout.
 */
const MainContent: React.FC = () => {
  useConnectErrorToast();
  return <AppRoutes />;
};

export default function App() {
  return (
    <ErrorBoundary>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            theme={darkTheme({
              accentColor: '#E8743B',
              accentColorForeground: '#0A0F1E',
              borderRadius: 'medium',
              fontStack: 'system',
              overlayBlur: 'small',
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
