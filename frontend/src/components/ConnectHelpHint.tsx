import React from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { HelpCircle } from 'lucide-react';

/**
 * Small troubleshooting hint shown directly under the Connect Wallet modal
 * (RainbowKit's overlay uses z-index 2147483646, so this sits one level above
 * it and is pinned to the bottom of the viewport).
 */
export const ConnectHelpHint: React.FC = () => {
  const { connectModalOpen } = useConnectModal();

  if (!connectModalOpen) return null;

  return (
    <div className="fixed inset-x-0 bottom-5 z-[2147483647] flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto max-w-lg w-full glass-card px-4 py-3 shadow-2xl"
      >
        <p
          className="flex items-center gap-1.5 text-xs font-semibold mb-1"
          style={{ color: 'rgba(255,255,255,0.9)' }}
        >
          <HelpCircle className="w-3.5 h-3.5" style={{ color: 'var(--copper)' }} />
          Having trouble connecting?
        </p>
        <ul
          className="text-[11px] list-disc ml-4 space-y-0.5 leading-relaxed"
          style={{ color: 'rgba(143,163,199,0.65)' }}
        >
          <li>
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>Unlock MetaMask</span> — open the extension and enter
            your password.
          </li>
          <li>
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>Check for a pending request</span> — approve or reject
            it in MetaMask, then retry.
          </li>
          <li>
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>Try Browser Wallet</span> for a direct connection.
          </li>
        </ul>
      </div>
    </div>
  );
};
