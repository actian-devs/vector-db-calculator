import { clampAssumption, DEFAULT_ASSUMPTIONS } from './assumptions';
import type {
  Assumptions,
  ChangeRate,
  Filtering,
  LatencyTargetMs,
  Matching,
  QpsBand,
  Residency,
  Tenancy,
  Workload,
} from './types';

/**
 * The whole state lives in the query string, so a shared link restores an exact
 * result and nothing has to be stored anywhere.
 */

export const DEFAULT_WORKLOAD: Workload = {
  items: 100_000,
  growth: 1,
  dims: 1536,
  latencyMs: 50,
  qps: 1,
  filtering: 'never',
  matching: 'semantic',
  changeRate: 'append',
  tenancy: 'single',
  residency: 'cloud',
  postgres: false,
};

/** Slider stops. The slider carries an index, not the raw count. */
export const ITEM_STEPS = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8] as const;

const LAT: LatencyTargetMs[] = [0, 10, 50, 200];
const QPS: QpsBand[] = [1, 10, 100, 101];
const FILTERING: Filtering[] = ['never', 'sometimes', 'always'];
const MATCHING: Matching[] = ['semantic', 'exact', 'hybrid'];
const CHANGE: ChangeRate[] = ['append', 'daily', 'constant'];
const TENANCY: Tenancy[] = ['single', 'many'];
const RESIDENCY: Residency[] = ['cloud', 'onprem', 'airgapped', 'edge'];

function oneOf<T>(allowed: readonly T[], raw: string | null, fallback: T): T {
  const hit = allowed.find((v) => String(v) === raw);
  return hit === undefined ? fallback : hit;
}

function positiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function encodeState(w: Workload, a: Assumptions): URLSearchParams {
  const q = new URLSearchParams();
  q.set('n', String(ITEM_STEPS.indexOf(w.items as (typeof ITEM_STEPS)[number])));
  // A custom item count that is not a slider stop is carried verbatim.
  if (!ITEM_STEPS.includes(w.items as (typeof ITEM_STEPS)[number])) {
    q.set('n', '-1');
    q.set('ni', String(w.items));
  }
  q.set('g', String(w.growth));
  q.set('d', String(w.dims));
  q.set('l', String(w.latencyMs));
  q.set('q', String(w.qps));
  q.set('f', w.filtering);
  q.set('m', w.matching);
  q.set('c', w.changeRate);
  q.set('t', w.tenancy);
  q.set('r', w.residency);
  q.set('p', w.postgres ? 'yes' : 'no');

  // Only non-default assumptions travel, to keep shared links short.
  (Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]).forEach((k) => {
    if (a[k] !== DEFAULT_ASSUMPTIONS[k]) q.set(`a.${k}`, String(a[k]));
  });

  return q;
}

export function decodeState(search: string): {
  workload: Workload;
  assumptions: Assumptions;
} {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return { workload: DEFAULT_WORKLOAD, assumptions: DEFAULT_ASSUMPTIONS };
  }

  const stepIndex = Number(q.get('n'));
  let items = DEFAULT_WORKLOAD.items;
  if (stepIndex === -1) {
    items = positiveInt(q.get('ni'), DEFAULT_WORKLOAD.items);
  } else if (Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < ITEM_STEPS.length) {
    items = ITEM_STEPS[stepIndex];
  }

  const workload: Workload = {
    items,
    growth: oneOf([1, 2, 10, 100], q.get('g'), DEFAULT_WORKLOAD.growth),
    dims: Math.min(16_384, Math.max(2, positiveInt(q.get('d'), DEFAULT_WORKLOAD.dims))),
    latencyMs: oneOf(LAT, q.get('l'), DEFAULT_WORKLOAD.latencyMs),
    qps: oneOf(QPS, q.get('q'), DEFAULT_WORKLOAD.qps),
    filtering: oneOf(FILTERING, q.get('f'), DEFAULT_WORKLOAD.filtering),
    matching: oneOf(MATCHING, q.get('m'), DEFAULT_WORKLOAD.matching),
    changeRate: oneOf(CHANGE, q.get('c'), DEFAULT_WORKLOAD.changeRate),
    tenancy: oneOf(TENANCY, q.get('t'), DEFAULT_WORKLOAD.tenancy),
    residency: oneOf(RESIDENCY, q.get('r'), DEFAULT_WORKLOAD.residency),
    postgres: q.get('p') === 'yes',
  };

  const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS };
  (Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]).forEach((k) => {
    const raw = q.get(`a.${k}`);
    if (raw === null) return;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      assumptions[k] = clampAssumption(k, n, DEFAULT_ASSUMPTIONS[k]);
    }
  });

  return { workload, assumptions };
}

/**
 * Rewrite the address bar without touching anything we did not put there,
 * so utm_campaign and friends survive.
 */
export function mergeIntoLocation(
  href: string,
  w: Workload,
  a: Assumptions,
): string {
  const url = new URL(href);
  // Drop any state keys we own before writing the current ones back.
  [...url.searchParams.keys()].forEach((key) => {
    if (key.startsWith('a.') || ['n', 'ni', 'g', 'd', 'l', 'q', 'f', 'm', 'c', 't', 'r', 'p'].includes(key)) {
      url.searchParams.delete(key);
    }
  });
  encodeState(w, a).forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
}
