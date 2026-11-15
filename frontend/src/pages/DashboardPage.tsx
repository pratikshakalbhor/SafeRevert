import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import {
  LayoutDashboard,
  Send,
  ListFilter,
  KeyRound,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { useTransfers } from '../hooks/useTransfers';
import { TransferState, NATIVE_TOKEN_ADDRESS } from '../lib/types';
import { getCountdown, formatLocalTimestamp } from '../lib/time';

const QUICK_LINKS = [
  { to: '/send', label: 'New transfer', hint: 'Lock funds with a delay', icon: Send },
  { to: '/transfers', label: 'My transfers', hint: 'Cancel, refund or track', icon: ListFilter },
  { to: '/claim', label: 'Claim', hint: 'Redeem with your secret', icon: KeyRound },
  { to: '/security', label: 'Security', hint: 'Threat model & FAQ', icon: Shield },
];

export const DashboardPage: React.FC = () => {
  const { address: userAddress } = useAccount();
  const { transfers, isLoading, error, refetch } = useTransfers();
  const [currentTimestamp, setCurrentTimestamp] = useState(() =>
    Math.floor(Date.now() / 1000)
  );

  // Live countdown clock (same cadence as the transfers page).
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTimestamp(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const account = userAddress?.toLowerCase() ?? '';
  const pending = transfers.filter((t) => t.state === TransferState.Pending);
  const sent = pending.filter((t) => t.sender.toLowerCase() === account);
  const received = pending.filter((t) => t.recipient.toLowerCase() === account);

  const nativePending = pending.filter(
    (t) => t.token.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()
  );
  const totalEth = nativePending.reduce((sum, t) => sum + t.amount, 0n);
  const erc20PendingCount = pending.length - nativePending.length;

  const unlockingSoon = [...pending]
    .sort((a, b) => Number(a.unlockTime) - Number(b.unlockTime))
    .slice(0, 4);

  // Bento tiles: hero card spans two columns, the others are compact squares.
  const stats = [
    {
      label: 'ETH currently locked',
      value: formatUnits(totalEth, 18),
      hero: true,
      span: 'md:col-span-2 lg:col-span-2',
    },
    {
      label: 'Pending transfers',
      value: String(pending.length),
      hero: false,
      span: '',
    },
    {
      label: 'Received (pending)',
      value: String(received.length),
      hero: false,
      span: '',
    },
    {
      label: 'Sent (pending)',
      value: String(sent.length),
      hero: false,
      span: 'md:col-span-2 lg:col-span-1',
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-copper-500/10 text-copper-300 border border-copper-500/30">
            <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-silver-100">
            Your escrow overview
          </h1>
          <p className="text-xs sm:text-sm text-silver-400">
            {userAddress ? (
              <>
                Connected as{' '}
                <span className="font-mono text-silver-300">
                  {userAddress.slice(0, 6)}…{userAddress.slice(-4)}
                </span>
              </>
            ) : (
              'Connect a wallet to see your transfers.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading}
          className="btn-secondary px-3.5 py-2 text-xs"
        >
          Refresh
        </button>
      </header>

      {/* Loading */}
      {isLoading && transfers.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="glass-card p-5 animate-pulse space-y-3"
            >
              <div className="h-3 bg-silver-800 rounded w-2/3" />
              <div className="h-6 bg-silver-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Error — copper with a warning icon (never red) */}
      {error && transfers.length === 0 && (
        <div className="alert-warning flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-2.5 flex-1 text-left">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold">Unable to load transfers</h4>
              <p className="text-xs opacity-90 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="btn-secondary px-4 py-1.5 text-xs shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Bento grid — glass cards of different sizes */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`glass-card p-5 flex flex-col justify-between gap-3 ${stat.span}`}
          >
            <p className="text-[10px] uppercase tracking-widest font-semibold text-silver-500">
              {stat.label}
            </p>
            {stat.hero ? (
              <div className="space-y-1.5">
                <p className="text-4xl sm:text-5xl font-semibold text-copper-300 font-tabular break-words leading-none">
                  {stat.value}
                </p>
                <p className="text-[11px] text-silver-500">
                  {erc20PendingCount > 0
                    ? `+ ${erc20PendingCount} ERC-20 transfer${erc20PendingCount > 1 ? 's' : ''} locked (outside this total)`
                    : 'Native ETH only'}
                </p>
              </div>
            ) : (
              <p className="text-2xl font-semibold text-silver-100 font-tabular break-words">
                {stat.value}
              </p>
            )}
          </div>
        ))}

        {/* Unlocking soonest — wide card */}
        <div className="glass-card p-5 md:col-span-2 lg:col-span-3 space-y-4">
          <h2 className="text-sm font-semibold text-silver-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-copper-400" /> Unlocking soonest
          </h2>

          {unlockingSoon.length === 0 ? (
            <div className="rounded-xl bg-silver-900/40 border border-silver-800 p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-silver-300">
                Nothing pending right now
              </p>
              <p className="text-xs text-silver-500">
                Locked transfers you send or receive will show up here.
              </p>
              <Link
                to="/send"
                className="btn-primary inline-block mt-1 px-4 py-2 text-xs"
              >
                Create a transfer
              </Link>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {unlockingSoon.map((item) => {
                const unlockTs = Number(item.unlockTime);
                const countdown = getCountdown(unlockTs, currentTimestamp);
                const isRecipient = item.recipient.toLowerCase() === account;
                return (
                  <li key={item.id.toString()}>
                    <Link
                      to={`/transfers/${item.id.toString()}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-silver-900/40 border border-silver-800 hover:border-copper-500/30 px-4 py-3 transition-colors"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-xs font-semibold text-silver-100 bg-navy px-2 py-1 rounded border border-silver-800">
                          #{item.id.toString()}
                        </span>
                        <span className="text-xs text-silver-300 truncate font-tabular">
                          {formatUnits(item.amount, item.tokenDecimals ?? 18)}{' '}
                          {item.tokenSymbol || 'ETH'}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                            isRecipient
                              ? 'bg-copper-500/10 text-copper-400 border-copper-500/20'
                              : 'bg-copper-500/10 text-copper-400 border-copper-500/20'
                          }`}
                        >
                          {isRecipient ? (
                            <ArrowDownLeft className="w-3 h-3" />
                          ) : (
                            <ArrowUpRight className="w-3 h-3" />
                          )}
                          {isRecipient ? 'Incoming' : 'Outgoing'}
                        </span>
                      </span>
                      <span className="flex items-center gap-3 text-[11px]">
                        <span className="font-mono text-silver-500 hidden sm:inline">
                          {formatLocalTimestamp(unlockTs)}
                        </span>
                        <span className="text-copper-300 font-semibold font-tabular">
                          Unlocks in {countdown.formatted}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 text-silver-500" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Quick links — full-width strip */}
        <div className="glass-card p-5 md:col-span-2 lg:col-span-4 space-y-4">
          <h2 className="text-sm font-semibold text-silver-100">Quick links</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-xl bg-silver-900/40 border border-silver-800 hover:border-copper-500/30 p-3.5 flex items-start gap-3 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-copper-500/10 border border-copper-500/20 flex items-center justify-center text-copper-400 shrink-0">
                  <link.icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-silver-100">{link.label}</p>
                  <p className="text-[11px] text-silver-500">{link.hint}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
