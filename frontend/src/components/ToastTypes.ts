import { createContext } from 'react';

export type ToastType = 'info' | 'success' | 'error' | 'loading';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  txHash?: string;
  autoClose?: boolean;
}

export interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  updateToast: (id: string, update: Partial<Omit<ToastItem, 'id'>>) => void;
  removeToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
