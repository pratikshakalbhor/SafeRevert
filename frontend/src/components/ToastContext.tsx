import React, { useState, useCallback } from 'react';
import { ExternalLink, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ToastContext, type ToastItem } from './ToastTypes';
import {
  toastVariants,
  toastVariantsReduced,
  pickVariants,
} from '../lib/motion';

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const reduced = useReducedMotion() ?? false;
  const variants = pickVariants(reduced, toastVariants, toastVariantsReduced);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { ...toast, id };
      setToasts((prev) => [...prev, newToast]);

      if (toast.autoClose !== false && toast.type !== 'loading') {
        setTimeout(() => {
          removeToast(id);
        }, 6000);
      }
      return id;
    },
    [removeToast]
  );

  const updateToast = useCallback(
    (id: string, update: Partial<Omit<ToastItem, 'id'>>) => {
      setToasts((prev) =>
        prev.map((t) => {
          if (t.id === id) {
            const updated = { ...t, ...update };
            if (updated.autoClose !== false && updated.type !== 'loading') {
              setTimeout(() => {
                removeToast(id);
              }, 6000);
            }
            return updated;
          }
          return t;
        })
      );
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, updateToast, removeToast }}>
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
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-xl backdrop-blur-md ${
                toast.type === 'success'
                  ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100'
                  : toast.type === 'error'
                  ? 'bg-rose-950/90 border-rose-500/50 text-rose-100'
                  : toast.type === 'loading'
                  ? 'bg-indigo-950/90 border-indigo-500/50 text-indigo-100'
                  : 'bg-slate-900/90 border-slate-700 text-slate-100'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" />}
                {toast.type === 'loading' && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />}
                {toast.type === 'info' && <AlertCircle className="w-5 h-5 text-sky-400" />}
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold leading-tight">{toast.title}</h4>
                {toast.message && (
                  <p className="mt-1 text-xs opacity-90 break-words leading-relaxed">{toast.message}</p>
                )}
                {toast.txHash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${toast.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline hover:opacity-80 transition-opacity"
                  >
                    View on Etherscan Sepolia
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
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
