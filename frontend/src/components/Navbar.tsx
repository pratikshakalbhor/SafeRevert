import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  ShieldCheck,
  Send,
  ListFilter,
  KeyRound,
  Home,
  LayoutDashboard,
  Shield,
  Menu,
  X,
} from 'lucide-react';

interface NavbarProps {
  myTransfersCount?: number;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Exact match only (Home). */
  end?: boolean;
  /** Renders the transfers count badge. */
  showBadge?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/send', label: 'Send', icon: Send },
  { to: '/transfers', label: 'My Transfers', icon: ListFilter, showBadge: true },
  { to: '/claim', label: 'Claim', icon: KeyRound },
  { to: '/security', label: 'Security', icon: Shield },
];

const NAV_BASE =
  'flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-200';

/** NavLink className helper — active link highlighted in the copper accent. */
const navClass =
  (isActive: boolean): string =>
  `${NAV_BASE} ${
    isActive
      ? 'border border-[rgba(232,116,59,0.28)]'
      : 'border border-transparent'
  }`;

const navStyle =
  (isActive: boolean): React.CSSProperties =>
  isActive
    ? {
        color: 'var(--copper)',
        background: 'rgba(232,116,59,0.1)',
      }
    : {
        color: 'rgba(143,163,199,0.7)',
        background: 'transparent',
      };

const badgeStyle: React.CSSProperties = {
  background: 'rgba(232,116,59,0.18)',
  color: 'var(--copper)',
};

export const Navbar: React.FC<NavbarProps> = ({ myTransfersCount }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const badge = myTransfersCount !== undefined && myTransfersCount > 0 ? (
    <span
      className="ml-1 px-1.5 rounded-full text-[11px] font-bold"
      style={badgeStyle}
    >
      {myTransfersCount}
    </span>
  ) : null;

  const renderLink = (item: NavItem) => (
    <>
      <item.icon className="w-4 h-4" />
      {item.label}
      {item.showBadge && badge}
    </>
  );

  return (
    <header
      className="sticky top-0 z-40 w-full"
      style={{
        borderBottom: '1px solid rgba(143,163,199,0.12)',
        background: 'rgba(10,15,30,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5 text-left group transition">
              <div
                className="w-9 h-9 rounded-xl p-0.5 flex items-center justify-center transition-transform group-hover:scale-105"
                style={{
                  background: 'rgba(232,116,59,0.12)',
                  border: '1px solid rgba(232,116,59,0.3)',
                }}
              >
                <ShieldCheck className="w-5 h-5" style={{ color: 'var(--copper)' }} />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="font-serif font-bold text-lg tracking-tight"
                    style={{ color: 'rgba(255,255,255,0.92)' }}
                  >
                    SafeRevert
                  </span>
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={{
                      background: 'rgba(143,163,199,0.1)',
                      color: 'var(--silver-blue)',
                      border: '1px solid rgba(143,163,199,0.18)',
                    }}
                  >
                    Sepolia
                  </span>
                </div>
                <p
                  className="text-[11px] hidden sm:block"
                  style={{ color: 'rgba(143,163,199,0.55)' }}
                >
                  Time-Locked Transfer Escrow
                </p>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav
              className="hidden md:flex items-center gap-1 p-1 rounded-xl"
              style={{
                background: 'rgba(143,163,199,0.04)',
                border: '1px solid rgba(143,163,199,0.1)',
              }}
            >
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => navClass(isActive)}
                  style={({ isActive }) => navStyle(isActive)}
                >
                  {() => renderLink(item)}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Wallet Connect + mobile menu toggle */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ConnectButton
              showBalance={false}
              chainStatus="icon"
              accountStatus={{
                smallScreen: 'avatar',
                largeScreen: 'full',
              }}
            />
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              className="md:hidden p-2 rounded-xl transition"
              style={{
                border: '1px solid rgba(143,163,199,0.14)',
                background: 'rgba(143,163,199,0.05)',
                color: 'rgba(143,163,199,0.8)',
              }}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileOpen && (
          <nav
            className="md:hidden border-t py-3 space-y-1"
            style={{ borderColor: 'rgba(143,163,199,0.08)' }}
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isActive ? 'border' : 'border border-transparent'
                  }`
                }
                style={({ isActive }) =>
                  isActive
                    ? {
                        color: 'var(--copper)',
                        background: 'rgba(232,116,59,0.1)',
                        borderColor: 'rgba(232,116,59,0.22)',
                      }
                    : {
                        color: 'rgba(143,163,199,0.7)',
                        background: 'transparent',
                      }
                }
              >
                {() => renderLink(item)}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
};
