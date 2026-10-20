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
  const { slow, fast } = throughputBounds(a);
  return {
    float32Bytes: items * dims * a.bytesPerComponentF32,
    int8Bytes: items * dims * a.bytesPerComponentInt8,
    comparisons,
    scanMsLow: (flops / (fast * 1e9)) * 1000,
    scanMsHigh: (flops / (slow * 1e9)) * 1000,
  };
}

/** Throughput inputs in order, whichever way round the user typed them. */
export function throughputBounds(a: Assumptions): { slow: number; fast: number } {
  return {
    slow: Math.min(a.gflopsLow, a.gflopsHigh),
    fast: Math.max(a.gflopsLow, a.gflopsHigh),
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
  const byTime = ((w.latencyMs / 1000) * throughputBounds(a).fast * 1e9) / (2 * w.dims);
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

/* ---------- infrastructure cost ---------- */

/** A monthly cost range in USD. `mid` is the midpoint of low and high. */
export interface CostRange {
  low: number;
  mid: number;
  high: number;
}

export interface MemoryCost {
  /** Memory the workload needs, decimal GB: index plus graph plus headroom. */
  memoryGb: number;
  monthly: CostRange;
  /** The int8 vector figure from the cost table, priced as shown (vectors only). */
  int8Gb: number;
  int8Monthly: CostRange;
}

/** Price inputs in order, whichever way round the user typed them. */
function priceBounds(a: Assumptions): { low: number; high: number } {
  return {
    low: Math.min(a.priceLowPerGbMonth, a.priceHighPerGbMonth),
    high: Math.max(a.priceLowPerGbMonth, a.priceHighPerGbMonth),
  };
}

/**
 * Memory an HNSW deployment of this size needs, in decimal GB.
 * items x dims x 4 bytes x graph overhead x headroom. Both multipliers are
 * rules of thumb and are labelled as estimates in the UI.
 */
export function memoryNeededGb(items: number, dims: number, a: Assumptions): number {
  return (
    (items * dims * a.bytesPerComponentF32 * a.hnswMemoryOverhead * a.headroom) / BYTES_PER_GB
  );
}

/** Monthly cost of `gb` decimal gigabytes at the assumed price range. */
export function costRange(gb: number, a: Assumptions): CostRange {
  const { low, high } = priceBounds(a);
  return { low: gb * low, mid: (gb * (low + high)) / 2, high: gb * high };
}

export function memoryCost(items: number, dims: number, a: Assumptions): MemoryCost {
  const memoryGb = memoryNeededGb(items, dims, a);
  const int8Gb = (items * dims * a.bytesPerComponentInt8) / BYTES_PER_GB;
  return {
    memoryGb,
    monthly: costRange(memoryGb, a),
    int8Gb,
    int8Monthly: costRange(int8Gb, a),
  };
}

export interface CostPoint extends CostRange {
  items: number;
}

/** The chart's x domain, matching the gauge: 1K to 100M items. */
export const COST_CHART_MIN_ITEMS = 1e3;
export const COST_CHART_MAX_ITEMS = 1e8;

/**
 * Cost computed continuously across the chart's range, log-spaced, from the
 * same functions as the card. The chart never draws anything this did not
 * compute, so the band and the table cannot disagree.
 */
export function costSeries(dims: number, a: Assumptions, points = 121): CostPoint[] {
  const lo = Math.log10(COST_CHART_MIN_ITEMS);
  const hi = Math.log10(COST_CHART_MAX_ITEMS);
  return Array.from({ length: points }, (_, i) => {
    const items = 10 ** (lo + ((hi - lo) * i) / (points - 1));
    return { items, ...costRange(memoryNeededGb(items, dims, a), a) };
  });
}
