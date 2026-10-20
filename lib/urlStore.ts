'use client';

/**
 * The query string is the single source of truth for the whole tool.
 *
 * Holding the same state in React as well would mean two things to keep in
 * step. Instead the URL is the store, React subscribes to it through
 * useSyncExternalStore, and every edit rewrites the URL with replaceState, so
 * edits add no history entries. That guarantees a shared link reproduces
 * exactly what the author saw.
 */

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeToSearch(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener('popstate', callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('popstate', callback);
  };
}

export function getSearch(): string {
  return window.location.search;
}

/**
 * The static export renders with no query string, so the server snapshot is
 * empty and the first client render matches it.
 */
export function getServerSearch(): string {
  return '';
}

export function replaceSearch(nextHref: string): void {
  window.history.replaceState(null, '', nextHref);
  emit();
}

export function getHref(): string {
  return window.location.href;
}
