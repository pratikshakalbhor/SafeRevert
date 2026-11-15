import React from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Lock, Undo2, KeyRound, ArrowRight, ShieldCheck } from 'lucide-react';

const STEPS = [
  {
    icon: Lock,
    title: '1. Lock with a time-limit',
    body: 'Send ETH or an ERC-20 into the vault with an unlock delay (1 min – 24 h) and an absolute expiry. You decide how long the recipient has to claim.',
  },
  {
    icon: Undo2,
    title: '2. Reverse before unlock',
    body: 'Changed your mind or picked the wrong address? The sender can cancel and reclaim everything any time before the unlock time — no secret needed.',
  },
  {
    icon: KeyRound,
    title: '3. Claim with the secret',
    body: 'Once unlocked, the recipient claims with a one-time 32-byte secret (kept only in your browser memory). If nobody claims by expiry, the sender refunds.',
  },
];

export const HomePage: React.FC = () => {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  return (
    <div className="relative overflow-hidden">
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Hero */}
        <section className="relative max-w-3xl mx-auto text-center py-20 sm:py-28 space-y-7">
          {/* Torch cone of copper light from the top centre (decorative) */}
          <div className="hero-glow" aria-hidden="true" />
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-semibold bg-copper-500/10 text-copper-300 border border-copper-500/30">
            <ShieldCheck className="w-3.5 h-3.5" /> Time-Locked Transfer Escrow
          </span>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-silver-100 leading-[1.06]">
            Send crypto you can{' '}
            <span className="text-copper">take back</span>{' '}
            — until it unlocks.
          </h1>
          <p className="text-base sm:text-lg text-silver-400 leading-relaxed max-w-2xl mx-auto">
            SafeRevert locks funds in an on-chain escrow with a delay. Before the
            unlock time the sender can cancel; after it the recipient claims with a
            secret; after expiry the sender is refunded. Wrong-address sends become
            reversible, and a stolen recipient key is useless until unlock.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            {!isConnected ? (
              <button
                type="button"
                onClick={() => openConnectModal?.()}
                className="btn-primary px-7 py-3.5 text-sm"
              >
                Connect Wallet
              </button>
            ) : (
              <Link
                to="/dashboard"
                className="btn-primary px-7 py-3.5 text-sm"
              >
                Go to Dashboard
              </Link>
            )}
            <Link
              to="/send"
              className="btn-secondary px-7 py-3.5 text-sm inline-flex items-center gap-2"
            >
              Create a transfer <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section className="pb-6">
          <h2 className="text-center text-2xl sm:text-3xl font-semibold text-silver-100 mb-10">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {STEPS.map((step) => (
              <div
                key={step.title}
                className="glass-card p-6 space-y-3 transition-colors hover:border-copper-500/30"
              >
                <div className="w-10 h-10 rounded-xl bg-copper-500/10 border border-copper-500/20 flex items-center justify-center text-copper-400">
                  <step.icon className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-silver-100">{step.title}</h3>
                <p className="text-xs text-silver-400 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust strip */}
        <section className="py-16 text-center space-y-3">
          <p className="text-xs text-silver-500 max-w-2xl mx-auto leading-relaxed">
            Secrets are generated in memory and never written to storage or URLs.
            The contract only stores their hash commitment.
          </p>
          <Link
            to="/security"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-copper-400 hover:text-copper-300 underline underline-offset-2"
          >
            Read the security model &amp; FAQ <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </section>
      </div>
    </div>
  );
};
