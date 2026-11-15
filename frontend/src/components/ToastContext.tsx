import React, { useState, useCallback, useMemo, useRef } from 'react';
import { ExternalLink, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ToastContext, type ToastItem, type ToastContextValue } from './ToastTypes';
import {
  toastVariants,
  toastVariantsReduced,
  pickVariants,
} from '../lib/motion';

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Synchronous mirror of `toasts`: state updates are async, so addToast needs
  // this ref to see a toast it just added (dedup within the same tick).
  const toastsRef = useRef<ToastItem[]>(toasts);
  const reduced = useReducedMotion() ?? false;
  const variants = pickVariants(reduced, toastVariants, toastVariantsReduced);

  // Single writer for the toast list: keeps the ref and the state in lockstep.
  const commit = useCallback((next: ToastItem[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      commit(toastsRef.current.filter((t) => t.id !== id));
    },
    [commit]
  );

  const addToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      // Deduplicate: while a toast with the same key (transaction hash) is
      // visible, do not stack a second copy of it.
      if (toast.key) {
        const existing = toastsRef.current.find((t) => t.key === toast.key);
        if (existing) return existing.id;
      }

      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { ...toast, id };
      commit([...toastsRef.current, newToast]);

      if (toast.autoClose !== false && toast.type !== 'loading') {
        setTimeout(() => {
          removeToast(id);
        }, 6000);
      }
      return id;
    },
    [commit, removeToast]
  );

  const updateToast = useCallback(
    (id: string, update: Partial<Omit<ToastItem, 'id'>>) => {
      let needsAutoClose = false;
      const next = toastsRef.current.map((t) => {
        if (t.id !== id) return t;
        const updated = { ...t, ...update };
        if (updated.autoClose !== false && updated.type !== 'loading') {
          needsAutoClose = true;
        }
        return updated;
      });
      commit(next);
      // Timer scheduled outside the state updater (updaters must stay pure).
      if (needsAutoClose) {
        setTimeout(() => {
          removeToast(id);
        }, 6000);
      }
    },
    [commit, removeToast]
  );

  // Stable context value: consumers only see a new object when one of these
  // four actually changes — never just because the provider re-rendered.
  const value = useMemo<ToastContextValue>(
    () => ({ toasts, addToast, updateToast, removeToast }),
    [toasts, addToast, updateToast, removeToast]
  );

  // Toast style maps: copper for success/error/warning (no red), navy+silver for info
  const toastStyles: Record<string, React.CSSProperties> = {
    success: {
      background: 'rgba(10,15,30,0.95)',
      border: '1px solid rgba(143,163,199,0.2)',
      color: 'rgba(255,255,255,0.92)',
      borderLeft: '3px solid var(--copper)',
    },
    error: {
      background: 'rgba(10,15,30,0.95)',
      border: '1px solid rgba(232,116,59,0.35)',
      color: 'rgba(255,255,255,0.92)',
      borderLeft: '3px solid var(--copper)',
    },
    loading: {
      background: 'rgba(10,15,30,0.95)',
      border: '1px solid rgba(143,163,199,0.2)',
      color: 'rgba(255,255,255,0.92)',
      borderLeft: '3px solid var(--silver-blue)',
    },
    info: {
      background: 'rgba(10,15,30,0.95)',
      border: '1px solid rgba(143,163,199,0.2)',
      color: 'rgba(255,255,255,0.92)',
      borderLeft: '3px solid var(--silver-blue)',
    },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toasts render above RainbowKit's connect-modal overlay (z-index 2147483646)
          so connection errors stay visible while the modal is open. */}
      <div className="fixed top-4 right-4 z-[2147483647] flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
              layout
              className="pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-xl backdrop-blur-md"
              style={{
                ...(toastStyles[toast.type] ?? toastStyles.info),
                borderRadius: '14px',
              }}
            >
              <div className="mt-0.5 shrink-0">
                {toast.type === 'success' && (
                  <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--copper)' }} />
                )}
                {toast.type === 'error' && (
                  <AlertTriangle className="w-5 h-5" style={{ color: 'var(--copper)' }} />
                )}
                {toast.type === 'loading' && (
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--silver-blue)' }} />
                )}
                {toast.type === 'info' && (
                  <AlertTriangle className="w-5 h-5" style={{ color: 'var(--silver-blue)' }} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold leading-tight">{toast.title}</h4>
                {toast.message && (
                  <p
                    className="mt-1 text-xs opacity-90 break-words leading-relaxed"
                    style={{ color: 'rgba(143,163,199,0.85)' }}
                  >
                    {toast.message}
                  </p>
                )}
                {toast.txHash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${toast.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--copper)' }}
                  >
                    View on Etherscan Sepolia
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className="p-1 rounded-md transition-colors"
                style={{ color: 'rgba(143,163,199,0.5)' }}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};
