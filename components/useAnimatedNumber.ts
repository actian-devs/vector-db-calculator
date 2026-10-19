'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const DURATION_MS = 420;
const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToMotion(callback: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

/** Live, so a mid-session preference change is respected. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Eases a number toward its target so readouts count rather than jump.
 *
 * The animation responds to something the user did. Under reduced motion the
 * hook returns the target untouched and never schedules a frame.
 */
export function useAnimatedNumber(target: number): number {
  const reduced = usePrefersReducedMotion();
  const [animated, setAnimated] = useState(target);
  // Tracks what is on screen so an interrupted run resumes from there.
  const currentRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) return;

    const from = currentRef.current;
    if (from === target) return;

    let start: number | null = null;

    const step = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      currentRef.current = value;
      setAnimated(value);
      frameRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [target, reduced]);

  if (reduced) return target;
  return animated;
}
