import data from '../data/memory-prices.json';

/**
 * Memory list prices, normalised to the units the model uses.
 *
 * Cloud providers price memory per GiB (2^30 bytes). The model counts decimal
 * GB (10^9 bytes), like the cost table. Pricing a decimal-GB figure at a per-GiB
 * rate overstates the cost by about 7%, so every rate is converted here.
 *
 * These are hardware list prices only. Nothing in this module names or prices
 * a database product, and no vendor name reaches the chart.
 */

export interface PriceEntry {
  provider: string;
  instance: string;
  region: string;
  vcpu: number;
  gib: number;
  hourlyUsd: number;
  sourceUrl: string;
  fetchedAt: string;
}

export interface PriceFile {
  pricedAt: string;
  entries: PriceEntry[];
  managedPostgres: PriceEntry[];
}

export const HOURS_PER_MONTH = 730;
export const BYTES_PER_GIB = 1_073_741_824;
export const BYTES_PER_GB = 1e9;
/** A price file older than this many days shows a staleness warning. */
export const STALE_AFTER_DAYS = 60;

export const PRICES: PriceFile = data as PriceFile;

/** Whole-instance hourly price spread over its memory, per GiB-month. */
export function perGibMonth(e: Pick<PriceEntry, 'hourlyUsd' | 'gib'>): number {
  return (e.hourlyUsd * HOURS_PER_MONTH) / e.gib;
}

/** The same rate per decimal GB-month, which is what the model multiplies by. */
export function perGbMonth(e: Pick<PriceEntry, 'hourlyUsd' | 'gib'>): number {
  return perGibMonth(e) * (BYTES_PER_GB / BYTES_PER_GIB);
}

/** Lowest and highest per-GB-month rate across the entries. */
export function priceRange(entries: PriceEntry[]): { low: number; high: number } {
  const rates = entries.map(perGbMonth).filter((r) => Number.isFinite(r) && r > 0);
  if (rates.length === 0) throw new Error('memory-prices.json has no usable entries');
  return { low: Math.min(...rates), high: Math.max(...rates) };
}

/** Rounded to the cent so defaults survive a URL round trip unchanged. */
const cents = (n: number) => Math.round(n * 100) / 100;

export const DEFAULT_PRICE_RANGE = (() => {
  const r = priceRange(PRICES.entries);
  return { low: cents(r.low), high: cents(r.high) };
})();

/** Days between an ISO date and now. */
export function ageInDays(pricedAt: string, now: Date): number {
  return (now.getTime() - new Date(`${pricedAt}T00:00:00Z`).getTime()) / 86_400_000;
}

export function isStale(pricedAt: string, now: Date, days = STALE_AFTER_DAYS): boolean {
  return ageInDays(pricedAt, now) > days;
}
