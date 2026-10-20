import { fullItems } from './format';
import { DEFAULT_PRICE_RANGE } from './prices';
import type { Assumptions } from './types';

/**
 * Default assumptions.
 *
 * These are estimates derived from the footprint arithmetic plus the widely
 * observed behaviour of brute-force search and HNSW indexes. They are not
 * benchmark results and must never be presented as measurements.
 *
 * Deliberately there is no fixed "pgvector tops out at N items" constant. What
 * actually governs an HNSW index is whether it fits in memory, which depends on
 * item count and dimensions, so the ceiling is derived rather than asserted.
 * See lib/compute.ts.
 *
 * All of these are editable in the UI. Anything the user changes travels with
 * the shared URL and appears in the exported decision record.
 */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  /** Memory available to hold vectors or a vector index, in gigabytes. */
  ramBudgetGb: 32,
  /**
   * HNSW stores the vectors plus a navigable graph. The graph adds roughly
   * half again on top of the raw vectors at common m values.
   */
  hnswMemoryOverhead: 1.5,
  /** Item count above which always-on metadata filtering starts to strain. */
  heavyFilterCeiling: 1_000_000,
  /** Stacked demands escalate only past half of what one Postgres can index. */
  stackingGateFraction: 0.5,
  bytesPerComponentF32: 4,
  bytesPerComponentInt8: 1,
  gflopsLow: 1,
  gflopsHigh: 10,
  /** Run the host at roughly three quarters full rather than at the limit. */
  headroom: 1.3,
  /** From data/memory-prices.json, converted from per GiB to per decimal GB. */
  priceLowPerGbMonth: DEFAULT_PRICE_RANGE.low,
  priceHighPerGbMonth: DEFAULT_PRICE_RANGE.high,
};

export interface AssumptionField {
  key: keyof Assumptions;
  label: string;
  help: string;
  scale: 'items' | 'gb' | 'gflops' | 'factor' | 'usd';
  min: number;
  max: number;
  step: number;
}

export const ASSUMPTION_FIELDS: AssumptionField[] = [
  {
    key: 'ramBudgetGb',
    label: 'Memory available (GB)',
    help: 'Drives both ceilings. A flat scan needs the vectors in memory; an HNSW index needs the vectors plus its graph.',
    scale: 'gb',
    min: 0.25,
    max: 4096,
    step: 1,
  },
  {
    key: 'hnswMemoryOverhead',
    label: 'HNSW graph overhead',
    help: 'Estimate. Multiplier on raw vector size to account for the navigable graph. Raise it for higher m.',
    scale: 'factor',
    min: 1,
    max: 5,
    step: 0.1,
  },
  {
    key: 'heavyFilterCeiling',
    label: 'Heavy filtering strains above',
    help: 'Item count above which an always-on metadata filter starts costing recall or latency on a general-purpose planner.',
    scale: 'items',
    min: 1_000,
    max: 1_000_000_000,
    step: 100_000,
  },
  {
    key: 'stackingGateFraction',
    label: 'Stacked demands count above (share of pgvector ceiling)',
    help: 'Estimate. Hybrid search, many tenants, constant churn and always-on filtering only push toward a dedicated store together, and only once the workload passes this share of what one Postgres instance can index.',
    scale: 'factor',
    min: 0.1,
    max: 1,
    step: 0.05,
  },
  {
    key: 'gflopsHigh',
    label: 'Effective throughput, high (GFLOP/s)',
    help: 'Optimistic single-node throughput. This sets the flat-scan ceiling, so raising it says a brute-force scan stays viable longer.',
    scale: 'gflops',
    min: 0.1,
    max: 10_000,
    step: 1,
  },
  {
    key: 'gflopsLow',
    label: 'Effective throughput, low (GFLOP/s)',
    help: 'Pessimistic throughput. Used for the slow end of the scan estimate and to warn when a flat scan is marginal.',
    scale: 'gflops',
    min: 0.1,
    max: 10_000,
    step: 1,
  },
  {
    key: 'headroom',
    label: 'Memory headroom',
    help: 'Estimate. Multiplier on the index size so the host is not run at its limit. Prices the memory, does not change the verdict.',
    scale: 'factor',
    min: 1,
    max: 4,
    step: 0.1,
  },
  {
    key: 'priceLowPerGbMonth',
    label: 'Memory price, low (USD per GB-month)',
    help: 'Per decimal GB (10^9 bytes). Default is the cheaper of the on-demand list prices in the data file, converted from per GiB.',
    scale: 'usd',
    min: 0.01,
    max: 100,
    step: 0.01,
  },
  {
    key: 'priceHighPerGbMonth',
    label: 'Memory price, high (USD per GB-month)',
    help: 'Per decimal GB (10^9 bytes). Default is the dearer of the on-demand list prices in the data file, converted from per GiB.',
    scale: 'usd',
    min: 0.01,
    max: 100,
    step: 0.01,
  },
];

export function isCustomised(a: Assumptions): boolean {
  return (Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]).some(
    (k) => a[k] !== DEFAULT_ASSUMPTIONS[k],
  );
}

export function changedAssumptions(a: Assumptions): (keyof Assumptions)[] {
  return (Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]).filter(
    (k) => a[k] !== DEFAULT_ASSUMPTIONS[k],
  );
}

export function clampAssumption(
  key: keyof Assumptions,
  value: number,
  current: number,
): number {
  if (!Number.isFinite(value)) return current;
  const field = ASSUMPTION_FIELDS.find((f) => f.key === key);
  // Anything without a field is fixed, not user editable, so it never changes.
  if (!field) return current;
  return Math.min(field.max, Math.max(field.min, value));
}

/**
 * Assumptions that only price the memory. They never change the verdict, and
 * telemetry leaves them out entirely, by name as well as by value.
 */
export const COST_ASSUMPTIONS: ReadonlySet<keyof Assumptions> = new Set([
  'headroom',
  'priceLowPerGbMonth',
  'priceHighPerGbMonth',
]);

/**
 * An assumption value as a reader should see it. Item counts are whole numbers;
 * everything else keeps its decimals, so a 1.5 multiplier never reads as 2.
 */
export function formatAssumption(field: Pick<AssumptionField, 'scale'>, value: number): string {
  if (field.scale === 'items') return fullItems(value);
  if (field.scale === 'usd') return `$${value.toFixed(2)}`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
