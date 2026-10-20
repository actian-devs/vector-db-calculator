/**
 * Domain types for the vector database sizing decision.
 *
 * Everything here is framework-free on purpose. `lib/` holds the decision model
 * and knows nothing about React or the DOM, so it can be unit tested directly
 * and reused outside this app.
 */

export type Matching = 'semantic' | 'exact' | 'hybrid';
export type Filtering = 'never' | 'sometimes' | 'always';
export type ChangeRate = 'append' | 'daily' | 'constant';
export type Tenancy = 'single' | 'many';
export type Residency = 'cloud' | 'onprem' | 'airgapped' | 'edge';

/** 0 means "latency does not matter". */
export type LatencyTargetMs = 0 | 10 | 50 | 200;

/** Upper bound of the band the user picked. 101 stands for "over 100". */
export type QpsBand = 1 | 10 | 100 | 101;

export interface Workload {
  /** Item count today, before growth is applied. */
  items: number;
  /** Multiplier applied over the next twelve months. */
  growth: number;
  /** Embedding dimensions. */
  dims: number;
  latencyMs: LatencyTargetMs;
  qps: QpsBand;
  filtering: Filtering;
  matching: Matching;
  changeRate: ChangeRate;
  tenancy: Tenancy;
  residency: Residency;
  /** Whether the team already operates Postgres. */
  postgres: boolean;
}

/**
 * Every estimate the model relies on, in one place and editable by the user.
 *
 * These are rule-of-thumb figures, not measurements. Exposing them is the point:
 * an engineer can replace them with numbers from their own hardware, and the
 * exported decision record carries whatever values were actually used.
 */
export interface Assumptions {
  /** Memory available to hold vectors or a vector index, in gigabytes. */
  ramBudgetGb: number;
  /** Multiplier on raw vector size for the HNSW navigable graph. */
  hnswMemoryOverhead: number;
  /** Item count above which always-on metadata filtering starts to strain. */
  heavyFilterCeiling: number;
  /**
   * Share of the pgvector ceiling a workload must pass before stacked
   * operational demands can escalate it.
   */
  stackingGateFraction: number;
  /** Bytes per vector component. */
  bytesPerComponentF32: number;
  bytesPerComponentInt8: number;
  /** Effective single-threaded throughput range used for the scan estimate. */
  gflopsLow: number;
  gflopsHigh: number;
  /** Spare memory on top of the index so the host is not run at 100%. Rule of thumb. */
  headroom: number;
  /** Memory price range, USD per decimal GB (10^9 bytes) per month. */
  priceLowPerGbMonth: number;
  priceHighPerGbMonth: number;
}

export type Tier = 0 | 1 | 2 | 3;

/**
 * A single driver behind the verdict.
 *
 * `dependsOn` makes the result auditable: a reader can see which assumption
 * produced a given reason, and change it if it does not match their hardware.
 */
export interface Reason {
  id: string;
  text: string;
  dependsOn?: (keyof Assumptions)[];
}

/**
 * An operational demand that is real work but that Postgres can meet.
 *
 * Surfaced rather than silently escalating, so a reader can see we considered
 * it and check the reasoning instead of taking the verdict on faith.
 */
export interface Consideration {
  id: string;
  text: string;
  /** How this is normally solved without a dedicated store. */
  handledBy: string;
}

export interface Decision {
  tier: Tier;
  /** Item count after growth. */
  items12: number;
  /** Flat-scan ceiling, derived from the latency target and dimensions. */
  flatCeiling: number;
  /** HNSW ceiling, derived from the memory budget and dimensions. */
  pgvectorCeiling: number;
  /** Headline and lede for this verdict, including the edge variant of tier 3. */
  copy: TierCopy;
  reasons: Reason[];
  considerations: Consideration[];
  /** Consideration ids that stacked to produce a tier 3, empty otherwise. */
  stacked: string[];
  whatWouldChange: string;
}

export interface Footprint {
  /** Bytes held by the vectors themselves. */
  float32Bytes: number;
  int8Bytes: number;
  /** Multiply-adds for one brute-force scan over the whole set. */
  comparisons: number;
  /** Order-of-magnitude range for a single-threaded brute-force scan. */
  scanMsLow: number;
  scanMsHigh: number;
}

export interface TierCopy {
  badge: string;
  headline: string;
  lede: string;
}
