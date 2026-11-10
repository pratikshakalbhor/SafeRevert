import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from './useToast';
import { describeConnectError } from '../lib/connectErrors';

/**
 * Shows a toast whenever wagmi's `connect` mutation fails.
 *
 * RainbowKit's Connect modal calls `connectAsync` from *its own*
 * `useConnect()` observer, and TanStack Query builds one Mutation instance per
 * observer — so an `onError` passed to a `useConnect()` inside this component
 * would never fire for modal attempts. Subscribing to the shared mutation
 * cache catches every mutation keyed `['connect']`, whichever component
 * started it, which is exactly the "mutation error" path.
 */
export const useConnectErrorToast = (): void => {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  // Identity-based dedupe: one toast per failed Mutation instance.
  const handledRef = useRef<WeakSet<object>>(new WeakSet());

  useEffect(() => {
    const cache = queryClient.getMutationCache();

    return cache.subscribe((event) => {
      const mutation = event.mutation;
      if (!mutation) return;

      const key = mutation.options.mutationKey;
      if (!Array.isArray(key) || key[0] !== 'connect') return;
      if (mutation.state.status !== 'error') return;
      if (handledRef.current.has(mutation)) return;
      handledRef.current.add(mutation);

      const { title, message } = describeConnectError(mutation.state.error);
      addToast({ type: 'error', title, message });
    });
  }, [queryClient, addToast]);
};
