/**
 * @vitest-environment jsdom
 */
import React, { useEffect, useRef, useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { ToastProvider } from './ToastContext';
import { useToast } from '../hooks/useToast';
import type { ToastContextValue } from './ToastTypes';

const TX_HASH = '0xdeadbeef';

/** Catches a render-loop crash instead of letting it escape the test. */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) return <div data-testid="crash" />;
    return this.props.children;
  }
}

/**
 * Mimics the original bug: an effect that reacts to "success" while its parent
 * hands down a *new* callback identity on every render. Without a
 * once-per-transaction guard this re-runs forever ("Maximum update depth
 * exceeded"); with the guard it fires exactly once.
 */
const SuccessWatcher: React.FC<{ onDone: (id: string) => void }> = ({ onDone }) => {
  const { addToast } = useToast();
  const handledRef = useRef<string | null>(null);

  // Latest-value ref: keeps the unstable prop out of the effect's identity.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (handledRef.current === TX_HASH) return; // exactly once per tx hash
    handledRef.current = TX_HASH;

    addToast({
      type: 'success',
      title: 'Transfer Locked in SafeRevert Vault!',
      message: 'Transfer #0 has been created. Save your secret now.',
      txHash: TX_HASH,
      key: TX_HASH,
    });
    onDoneRef.current(TX_HASH);
  }, [addToast, onDone]);

  return <div data-testid="watcher" />;
};

/** Parent that re-creates its callback on every render (the original trigger). */
const Parent: React.FC = () => {
  const [count, setCount] = useState(0);
  const handleDone = () => setCount((c) => c + 1); // fresh identity each render
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SuccessWatcher onDone={handleDone} />
        <div data-testid="count">{count}</div>
      </ToastProvider>
    </ErrorBoundary>
  );
};

/** Calls addToast three times in one effect: two share a key, one differs. */
const DuplicateToaster: React.FC = () => {
  const { addToast } = useToast();
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    addToast({ type: 'success', title: 'Dup A', key: TX_HASH });
    addToast({ type: 'success', title: 'Dup A suppressed', key: TX_HASH });
    addToast({ type: 'info', title: 'Other tx', key: 'other-tx' });
  }, [addToast]);
  return null;
};

/** Records the context object identity on every render. */
const ValueProbe: React.FC<{ onValue: (value: ToastContextValue) => void }> = ({
  onValue,
}) => {
  const context = useToast();
  useEffect(() => {
    onValue(context);
  });
  return null;
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe('ToastProvider render-loop safety', () => {
  it('shows exactly one toast across many rerenders and never hits a render loop', () => {
    const { rerender } = render(<Parent />);

    // Re-render several times: each pass hands SuccessWatcher a brand-new
    // `onDone`, so an unguarded effect would fire again on every one.
    for (let i = 0; i < 8; i++) {
      rerender(<Parent />);
    }

    // No "Maximum update depth exceeded" was logged.
    const depthExceeded = consoleErrorSpy.mock.calls.some(
      (call: unknown[]) =>
        call.some((arg: unknown) => String(arg).includes('Maximum update depth'))
    );
    expect(depthExceeded).toBe(false);

    // No crash was caught by the boundary.
    expect(screen.queryByTestId('crash')).toBeNull();

    // Exactly one toast, and the effect only ever ran its side effect once.
    expect(
      screen.getAllByText('Transfer Locked in SafeRevert Vault!')
    ).toHaveLength(1);
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('does not stack a second toast with the same key while the first is visible', () => {
    render(
      <ToastProvider>
        <DuplicateToaster />
      </ToastProvider>
    );

    // Same tx hash -> suppressed.
    expect(screen.getAllByText('Dup A')).toHaveLength(1);
    expect(screen.queryByText('Dup A suppressed')).toBeNull();
    // Different tx hash -> still shown.
    expect(screen.getByText('Other tx')).toBeTruthy();
  });

  it('keeps the context value identity stable while the provider re-renders', () => {
    const values: ToastContextValue[] = [];
    // Fresh elements each pass so React actually re-renders the provider
    // (reusing one element reference makes React bail out entirely).
    const tree = () => (
      <ToastProvider>
        <ValueProbe onValue={(value) => values.push(value)} />
      </ToastProvider>
    );

    const { rerender } = render(tree());
    for (let i = 0; i < 5; i++) {
      rerender(tree());
    }

    expect(values.length).toBeGreaterThan(1);
    expect(new Set(values).size).toBe(1);
  });
});
