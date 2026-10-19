import type { Assumptions, Footprint, Workload } from './types';

const BYTES_PER_GB = 1e9;

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
export function footprint(items: number, dims: number, a: Assumptions): Footprint {
  const comparisons = items * dims;
  // One multiply plus one add per component.
  const flops = 2 * comparisons;
  return {
    float32Bytes: items * dims * a.bytesPerComponentF32,
    int8Bytes: items * dims * a.bytesPerComponentInt8,
    comparisons,
    scanMsLow: (flops / (a.gflopsHigh * 1e9)) * 1000,
    scanMsHigh: (flops / (a.gflopsLow * 1e9)) * 1000,
  };
}

/** Estimated brute-force scan time at a given throughput, in milliseconds. */
export function scanMs(items: number, dims: number, gflops: number): number {
  return ((2 * items * dims) / (gflops * 1e9)) * 1000;
}

/** Largest item count whose vectors still fit in the memory budget. */
export function memoryCeiling(dims: number, a: Assumptions): number {
  return (a.ramBudgetGb * BYTES_PER_GB) / (dims * a.bytesPerComponentF32);
}

/**
 * The largest item count a flat scan can hold.
 *
 * Derived from the same arithmetic the page displays, rather than asserted as a
 * constant, so the recommendation can no longer contradict the scan estimate
 * shown beside it. Dimensions therefore change the tier, which they must: a
 * million 384-dimension vectors is a quarter of the work of a million at 1536.
 *
 * With no latency target the binding constraint is memory rather than time.
 */
export function flatCeiling(w: Workload, a: Assumptions): number {
  const byMemory = memoryCeiling(w.dims, a);
  if (w.latencyMs === 0) return byMemory;
  // Solve scanMs(items) = target at the optimistic end of the throughput range.
  const byTime = ((w.latencyMs / 1000) * a.gflopsHigh * 1e9) / (2 * w.dims);
  return Math.min(byTime, byMemory);
}

/**
 * The practical ceiling for an HNSW index on a single Postgres instance.
 *
 * What governs pgvector at scale is whether the index fits in memory. Once it
 * spills to disk, latency degrades sharply. Deriving the ceiling from the
 * memory budget and the dimensions is defensible in a way that a fixed item
 * count is not, and it rises as soon as a reader tells the tool about the
 * hardware they actually have.
 */
export function pgvectorCeiling(w: Workload, a: Assumptions): number {
  return (
    (a.ramBudgetGb * BYTES_PER_GB) /
    (w.dims * a.bytesPerComponentF32 * a.hnswMemoryOverhead)
  );
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
