import React from 'react';
import { VAULT_ADDRESS, IS_VAULT_CONFIGURED } from '../lib/config';
import { ShieldCheck, ExternalLink, AlertTriangle, HelpCircle } from 'lucide-react';

const THREATS = [
  {
    title: 'Wrong address / mistyped recipient',
    defense:
      'The sender can cancel and reclaim the full amount any time before the unlock time, so a misdirected transfer is reversible while the delay runs.',
  },
  {
    title: 'Compromised recipient key before unlock',
    defense:
      'A thief holding the recipient private key still cannot claim until the unlock time. That window gives the sender time to cancel and recover the funds.',
  },
  {
    title: 'Claim without the secret',
    defense:
      'The contract stores only keccak256(secret). Claiming requires the pre-image, so observing the on-chain hash does not let anyone else take the money. (The optional zero-hash mode removes this protection and says so in the UI.)',
  },
  {
    title: 'Reentrancy & fee-on-transfer tokens',
    defense:
      'State changes follow checks-effects-interactions with OpenZeppelin ReentrancyGuard, and amounts are measured by balance-before/after so deflationary tokens cannot under-deliver.',
  },
  {
    title: 'Sender stealing funds after unlock',
    defense:
      'Cancel is only possible strictly before unlock; after that only the recipient can claim, and only the sender can refund after expiry.',
  },
];

const LIMITATIONS = [
  'No admin, no pausability, no upgradeability — the deployed bytecode is final. There is nobody who can freeze, reverse or rescue funds outside the rules above.',
  'Timestamps come from block.timestamp. Validators can nudge them by a few seconds; never rely on sub-minute precision for the delay or expiry.',
  'If the recipient never claims and the sender never refunds after expiry, the funds stay in the contract indefinitely. There is no third-party recovery path.',
  'The secret exists only in the sender\'s browser memory at creation time. If it is lost before the recipient receives it, the transfer can only be reclaimed by the sender after expiry.',
  'The hash commitment is public: observers can see that a transfer uses a secret, and can confirm a guessed secret. The secret itself is never stored on-chain.',
  'Claims are visible in the mempool. That does not expose the secret, but it can reveal intent before inclusion.',
  'The frontend reads and writes through your RPC provider; a malicious RPC can show stale data. Always cross-check large transfers on a block explorer.',
];

const FAQ = [
  {
    q: 'Do I need an account or password?',
    a: 'No. Your wallet is your sign-in. SafeRevert never asks for — and could never verify — a username or password.',
  },
  {
    q: 'Where is my secret stored?',
    a: 'Only in the memory of the browser tab that created the transfer. It is never written to localStorage, sessionStorage, cookies or the URL, and it is wiped when you close the reveal modal or the tab.',
  },
  {
    q: 'Can SafeRevert take my money?',
    a: 'No. There is no privileged role in the contract. Funds can only leave via claim (recipient, with the secret), cancel (sender, before unlock) or refund (sender, after expiry).',
  },
  {
    q: 'What if I lose the secret after sending?',
    a: 'The recipient cannot claim without it. Once the expiry passes, the sender can refund and get the funds back.',
  },
];

export const SecurityPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-10">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-copper-500/10 text-copper-300 border border-copper-500/30">
          <ShieldCheck className="w-3.5 h-3.5" /> Security &amp; FAQ
        </span>
        <h1 className="text-3xl font-bold text-silver-100">
          Threat model &amp; safeguards
        </h1>
        <p className="text-sm text-silver-400 leading-relaxed">
          SafeRevert is a small, immutable escrow contract. This page summarises
          what it defends against, what it deliberately does not do, and answers
          the questions we hear most often.
        </p>
      </header>

      {/* Threat model */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-silver-100">What it protects against</h2>
        <div className="space-y-3">
          {THREATS.map((item) => (
            <div
              key={item.title}
              className="glass-card p-4 flex gap-3"
            >
              <ShieldCheck className="w-4 h-4 text-copper-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-silver-100">{item.title}</h3>
                <p className="text-xs text-silver-400 leading-relaxed mt-1">
                  {item.defense}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Limitations */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-silver-100 flex items-center gap-2">
          <AlertTriangle className="w-4 h-5 text-copper-400" /> Known limitations
        </h2>
        <ul className="space-y-2.5">
          {LIMITATIONS.map((item) => (
            <li
              key={item}
              className="text-xs text-silver-400 leading-relaxed bg-silver-900/40 border border-silver-800/80 rounded-lg p-3.5 flex gap-2.5"
            >
              <span className="text-copper-500 shrink-0">•</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-silver-100 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-copper-400" /> FAQ
        </h2>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <div key={item.q} className="glass-card p-4">
              <h3 className="text-sm font-semibold text-silver-100">{item.q}</h3>
              <p className="text-xs text-silver-400 leading-relaxed mt-1.5">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Contract address */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-silver-100">Contract</h2>
        <div className="glass-card p-4 space-y-2">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-silver-500">
            SafeRevertVault on Sepolia
          </span>
          {IS_VAULT_CONFIGURED ? (
            <>
              <p
                className="font-mono text-xs sm:text-sm text-silver-100 break-all"
                title={VAULT_ADDRESS}
              >
                {VAULT_ADDRESS}
              </p>
              <a
                href={`https://sepolia.etherscan.io/address/${VAULT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-copper-400 hover:text-copper-300 underline underline-offset-2"
              >
                View on Etherscan Sepolia <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </>
          ) : (
            <p className="text-xs text-copper-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                VITE_VAULT_ADDRESS is not configured yet — set it to see the
                deployed address here.
              </span>
            </p>
          )}
        </div>
      </section>
    </div>
  );
};
