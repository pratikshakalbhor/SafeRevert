import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { NetworkBanner } from './NetworkBanner';
import { ConnectHelpHint } from './ConnectHelpHint';
import { Navbar } from './Navbar';
import { useTransfers } from '../hooks/useTransfers';
import {
  pageVariants,
  pageVariantsReduced,
  pickVariants,
} from '../lib/motion';

/**
 * Shared shell for every route: network/config banner, connect hint, navbar
 * (links + wallet button), the routed page body and the footer.
 */
export const AppLayout: React.FC = () => {
  const { transfers } = useTransfers();
  const location = useLocation();
  const reduced = useReducedMotion() ?? false;
  const variants = pickVariants(reduced, pageVariants, pageVariantsReduced);

  return (
    <div className="min-h-screen flex flex-col sr-bg font-sans">
      {/* Network & Configuration Banner */}
      <NetworkBanner />

      {/* Troubleshooting hint shown while the Connect Wallet modal is open */}
      <ConnectHelpHint />

      {/* Navigation Bar (links, active highlight, wallet button) */}
      <Navbar myTransfersCount={transfers.length} />

      {/* Routed Page Body — keyed by path so motion replays per navigation.
          overflow-x-clip (not -hidden) keeps the horizontal guard without
          forcing overflow-y to auto, which would clip button beams near the
          top of the page. */}
      <main className="flex-1 w-full pb-16 overflow-x-clip">
        <motion.div
          key={location.pathname}
          variants={variants}
          initial="hidden"
          animate="visible"
        >
          <Outlet />
        </motion.div>
      </main>

      {/* Footer */}
      <footer
        className="py-6 text-center text-xs"
        style={{
          borderTop: '1px solid rgba(143,163,199,0.1)',
          background: 'rgba(10,15,30,0.5)',
          color: 'rgba(143,163,199,0.5)',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>
            SafeRevert &middot; Time-Locked Transfer Escrow on Ethereum Sepolia
          </p>
          <p className="text-[11px]" style={{ color: 'rgba(143,163,199,0.35)' }}>
            Never stores private keys or secrets. Secret strings live only in component memory.
          </p>
        </div>
      </footer>
    </div>
  );
};
