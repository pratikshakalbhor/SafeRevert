import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  /** Full text placed on the clipboard (e.g. the complete address). */
  value: string;
  /** Accessible name / tooltip before copying. */
  label?: string;
  /** Optional extra classes for layout (e.g. shrink-0). */
  className?: string;
}

/**
 * Small copy-to-clipboard button with a short-lived "Copied" confirmation.
 * Pure UI: reads nothing and writes only the given string to the clipboard —
 * no contract or transaction logic involved.
 */
export const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  label = 'Copy address',
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked by the browser — keep the idle state, no crash.
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
        copied
          ? 'border-copper-500/40 text-copper-300'
          : 'border-silver-800 text-silver-400 hover:border-copper-500/40 hover:text-copper-300'
      } ${className}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};
