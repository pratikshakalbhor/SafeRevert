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
        <div
          className="px-4 py-3 text-sm"
          style={{
            background: 'rgba(232,116,59,0.08)',
            borderBottom: '1px solid rgba(232,116,59,0.25)',
            color: 'var(--copper)',
          }}
        >
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--copper)' }} />
              <span>
                <strong>Wrong Network:</strong> Connected to{' '}
                <strong>{chain?.name || `Chain #${chain?.id}`}</strong>. SafeRevert is deployed on{' '}
                <strong>Sepolia (Chain ID 11155111)</strong>.
              </span>
            </div>
            <button
              onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}
              disabled={isPending}
              className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs disabled:opacity-50"
            >
              {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Switch to Sepolia
            </button>
          </div>
        </div>
      )}

      {configIssues.length > 0 && (
        <div
          className="alert-info"
          style={{ borderBottom: '1px solid rgba(143,163,199,0.14)' }}
        >
          <div className="max-w-7xl mx-auto flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--silver-blue)' }} />
            <div>
              <strong className="block mb-0.5">Environment not fully configured:</strong>
              <ul className="list-disc ml-5 space-y-0.5">
                {configIssues.map((issue) => (
                  <li key={issue.name}>
                    Set{' '}
                    <code
                      className="px-1 py-0.5 rounded font-mono text-[11px]"
                      style={{ background: 'rgba(143,163,199,0.1)', color: 'var(--silver-blue)' }}
                    >
                      {issue.name}
                    </code>{' '}
                    in{' '}
                    <code
                      className="px-1 py-0.5 rounded font-mono text-[11px]"
                      style={{ background: 'rgba(143,163,199,0.1)', color: 'var(--silver-blue)' }}
                    >
                      frontend/.env
                    </code>{' '}
                    — {issue.why}.
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
