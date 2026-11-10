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
      <div className="pointer-events-auto max-w-lg w-full rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur px-4 py-3 shadow-2xl">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-100 mb-1">
          <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
          Having trouble connecting?
        </p>
        <ul className="text-[11px] text-slate-400 list-disc ml-4 space-y-0.5 leading-relaxed">
          <li>
            <span className="text-slate-300">Unlock MetaMask</span> — open the extension and enter
            your password.
          </li>
          <li>
            <span className="text-slate-300">Check for a pending request</span> — approve or reject
            it in MetaMask, then retry.
          </li>
          <li>
            <span className="text-slate-300">Try Browser Wallet</span> for a direct connection.
          </li>
        </ul>
      </div>
    </div>
  );
};
