'use client';

import { replaceUrl } from './analytics';

/**
 * The query string is the single source of truth for the whole tool.
 *
 * Holding the same state in React as well would mean two things to keep in
 * step. Instead the URL is the store, React subscribes to it through
 * useSyncExternalStore, and every edit rewrites the URL, so edits add no
 * history entries. That guarantees a shared link reproduces exactly what the
 * author saw.
 *
 * The write goes through replaceUrl, which calls the native replaceState
 * captured before gtag.js loads. Calling history.replaceState itself would be
 * a page_view under enhanced measurement, and that setting is not ours to turn
 * off. The address bar still updates, so a copied URL still reproduces the
 * verdict.
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
  replaceUrl(nextHref);
  emit();
}

export function getHref(): string {
  return window.location.href;
}
