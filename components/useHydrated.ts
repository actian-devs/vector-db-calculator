'use client';

import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

/**
 * False in the static HTML and during hydration, true once the browser has
 * taken over. The export is rendered with no query string, so anything that
 * depends on the shared link waits for this rather than flashing the default
 * verdict at someone who opened a tier 3 link.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
