import type { Assumptions } from './types';

/**
 * Default assumptions.
 *
 * These are estimates derived from the footprint arithmetic plus the widely
 * observed behaviour of brute-force search and HNSW indexes. They are not
 * benchmark results and must never be presented as measurements.
 *
 * They are editable in the UI. Anything the user changes travels with the
 * shared URL and appears in the exported decision record.
 */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  flatScanUnder10ms: 10_000,
  flatScanUnder50ms: 100_000,
  flatScanUnder200ms: 1_000_000,
  pgvectorCeiling: 1_000_000,
  heavyFilterCeiling: 100_000,
  bytesPerComponentF32: 4,
  bytesPerComponentInt8: 1,
  gflopsLow: 1,
  gflopsHigh: 10,
};

export interface AssumptionField {
  key: keyof Assumptions;
  label: string;
  help: string;
  /** Rendered as an item count rather than a raw number. */
  scale: 'items' | 'bytes' | 'gflops';
  min: number;
  max: number;
}

export const ASSUMPTION_FIELDS: AssumptionField[] = [
  {
    key: 'flatScanUnder10ms',
    label: 'Flat scan holds under 10ms up to',
    help: 'Largest item count a single-threaded in-memory cosine scan answers inside 10ms.',
    scale: 'items',
    min: 100,
    max: 100_000_000,
  },
  {
    key: 'flatScanUnder50ms',
    label: 'Flat scan holds under 50ms up to',
    help: 'Same, for a 50ms target.',
    scale: 'items',
    min: 100,
    max: 100_000_000,
  },
  {
    key: 'flatScanUnder200ms',
    label: 'Flat scan holds under 200ms up to',
    help: 'Same, for a 200ms target.',
    scale: 'items',
    min: 100,
    max: 100_000_000,
  },
  {
    key: 'pgvectorCeiling',
    label: 'pgvector ceiling',
    help: 'Item count beyond which a single Postgres instance with HNSW stops being the simple answer.',
    scale: 'items',
    min: 1_000,
    max: 1_000_000_000,
  },
  {
    key: 'heavyFilterCeiling',
    label: 'Heavy filtering strains above',
    help: 'Item count above which always-on metadata filtering starts costing recall or latency.',
    scale: 'items',
    min: 1_000,
    max: 1_000_000_000,
  },
  {
    key: 'gflopsLow',
    label: 'Effective throughput, low',
    help: 'Pessimistic single-threaded GFLOP/s used for the slow end of the scan estimate.',
    scale: 'gflops',
    min: 0.1,
    max: 1_000,
  },
  {
    key: 'gflopsHigh',
    label: 'Effective throughput, high',
    help: 'Optimistic single-threaded GFLOP/s used for the fast end of the scan estimate.',
    scale: 'gflops',
    min: 0.1,
    max: 1_000,
  },
];

/** True when the user has moved anything away from the shipped defaults. */
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

/** Clamp a single assumption into its declared range, ignoring junk input. */
export function clampAssumption(
  key: keyof Assumptions,
  value: number,
  current: number,
): number {
  if (!Number.isFinite(value)) return current;
  const field = ASSUMPTION_FIELDS.find((f) => f.key === key);
  if (!field) return value;
  return Math.min(field.max, Math.max(field.min, value));
}
