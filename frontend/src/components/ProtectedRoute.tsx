import React from 'react';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Wallet = login. SafeRevert has no username/password, so a protected page
 * renders this gate instead of its content until a wallet is connected.
 * Public pages (Home, Security, 404) never go through this wrapper.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  if (isConnected) return <>{children}</>;

  return (
    <div className="max-w-lg mx-auto px-4 py-16">
      <div
        role="region"
        aria-label="Wallet required"
        className="glass-card p-10 text-center space-y-4"
      >
        <div className="w-12 h-12 bg-copper-500/10 text-copper-400 rounded-2xl flex items-center justify-center mx-auto border border-copper-500/20">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-silver-100">Connect your wallet to continue</h2>
        <p className="text-sm text-silver-400 leading-relaxed">
          Your wallet is your sign-in — there is no username or password. It only
          tells SafeRevert which transfers belong to you; your keys never leave
          your device.
        </p>
        <button
          type="button"
          onClick={() => openConnectModal?.()}
          className="btn-primary px-6 py-3 text-sm"
        >
          Connect Wallet
        </button>
        <div className="pt-1">
          <Link
            to="/"
            className="text-xs text-copper-400 hover:text-copper-300 underline underline-offset-2"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
};
