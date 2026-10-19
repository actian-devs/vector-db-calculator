import type { Assumptions, Footprint, Workload } from './types';

/** Item count after the twelve-month growth multiplier. */
export function itemsAfterGrowth(w: Workload): number {
  return w.items * w.growth;
}

/**
 * Exact arithmetic for a given item count.
 *
 * Memory and comparison counts are not estimates. The scan range is, and it
 * carries the GFLOP/s assumptions it was derived from.
 */
export function footprint(
  items: number,
  dims: number,
  a: Assumptions,
): Footprint {
  const comparisons = items * dims;
  // One multiply plus one add per component.
  const flops = 2 * comparisons;
  return {
    float32Bytes: items * dims * a.bytesPerComponentF32,
    int8Bytes: items * dims * a.bytesPerComponentInt8,
    comparisons,
    scanMsLow: flops / (a.gflopsHigh * 1e9) * 1000,
    scanMsHigh: flops / (a.gflopsLow * 1e9) * 1000,
  };
}

/** The flat-scan ceiling implied by the chosen latency target. */
export function flatCeiling(w: Workload, a: Assumptions): number {
  if (w.latencyMs === 10) return a.flatScanUnder10ms;
  if (w.latencyMs === 50) return a.flatScanUnder50ms;
  // Both the 200ms target and "does not matter" use the same practical ceiling.
  return a.flatScanUnder200ms;
}

/**
 * Position on the 1K to 100M log scale, clamped to 0..1.
 * Drives the arc gauge.
 */
export function logPosition(items: number): number {
  if (items <= 0) return 0;
  const p = (Math.log10(items) - 3) / 5;
  return Math.min(1, Math.max(0, p));
}
