import React from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';
import {
  TARGET_CHAIN,
  IS_VAULT_CONFIGURED,
  IS_WALLETCONNECT_CONFIGURED,
} from '../lib/config';

export const NetworkBanner: React.FC = () => {
  const { isConnected, chain } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  const isWrongNetwork = isConnected && chain?.id !== TARGET_CHAIN.id;

  // Missing-configuration warnings: variable NAMES only, never their values.
  const configIssues: { name: string; why: string }[] = [];
  if (!IS_VAULT_CONFIGURED) {
    configIssues.push({
      name: 'VITE_VAULT_ADDRESS',
      why: 'the deployed SafeRevertVault address on Sepolia — without it, transfers cannot be sent or listed',
    });
  }
  if (!IS_WALLETCONNECT_CONFIGURED) {
    configIssues.push({
      name: 'VITE_WALLETCONNECT_PROJECT_ID',
      why: 'your WalletConnect Cloud project id — without it, QR / WalletConnect connections fail',
    });
  }

  return (
    <div className="flex flex-col w-full">
      {isWrongNetwork && (
        <div className="bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 border-b border-amber-500/30 px-4 py-3 text-amber-200">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <span>
                <strong>Wrong Network:</strong> Connected to <strong>{chain?.name || `Chain #${chain?.id}`}</strong>. SafeRevert is deployed on <strong>Sepolia (Chain ID 11155111)</strong>.
              </span>
            </div>
            <button
              onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors shadow-sm disabled:opacity-50"
            >
              {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Switch to Sepolia
            </button>
          </div>
        </div>
      )}

      {configIssues.length > 0 && (
        <div className="bg-indigo-950/40 border-b border-indigo-800/40 px-4 py-2 text-indigo-300 text-xs">
          <div className="max-w-7xl mx-auto flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block mb-0.5">Environment not fully configured:</strong>
              <ul className="list-disc ml-5 space-y-0.5">
                {configIssues.map((issue) => (
                  <li key={issue.name}>
                    Set <code className="bg-indigo-900/50 px-1 py-0.5 rounded font-mono">{issue.name}</code> in <code className="bg-indigo-900/50 px-1 py-0.5 rounded font-mono">frontend/.env</code> — {issue.why}.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
