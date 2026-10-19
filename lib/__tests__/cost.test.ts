import { describe, expect, it } from 'vitest';
import { COST_ASSUMPTIONS, DEFAULT_ASSUMPTIONS } from '../assumptions';
import { costRange, costSeries, memoryCost, memoryNeededGb } from '../compute';
import { decide, hasMemoryEstimate } from '../decision';
import { costEstimate, decisionRecordJson, decisionRecordMarkdown } from '../exportRecord';
import {
  BYTES_PER_GIB,
  DEFAULT_PRICE_RANGE,
  PRICES,
  isStale,
  perGbMonth,
  perGibMonth,
  priceRange,
} from '../prices';
import { buildPayload } from '../telemetry';
import type { Assumptions, Tier, Workload } from '../types';
import { decodeState, DEFAULT_WORKLOAD, encodeState } from '../urlState';

const A = DEFAULT_ASSUMPTIONS;
const w = (over: Partial<Workload> = {}): Workload => ({ ...DEFAULT_WORKLOAD, ...over });

describe('price data and units', () => {
  it('converts per GiB to per decimal GB, about 7% lower', () => {
    const aws = { hourlyUsd: 0.2646, gib: 32 };
    expect(perGibMonth(aws)).toBeCloseTo((0.2646 * 730) / 32, 10);
    expect(perGbMonth(aws)).toBeCloseTo(perGibMonth(aws) * (1e9 / BYTES_PER_GIB), 10);
    expect(perGbMonth(aws)).toBeCloseTo(5.62, 2);
    expect(perGibMonth(aws) / perGbMonth(aws)).toBeCloseTo(1.0737, 4);
  });

  it('derives the default range from the data file, low never above high', () => {
    const r = priceRange(PRICES.entries);
    expect(r.low).toBeLessThanOrEqual(r.high);
    expect(DEFAULT_PRICE_RANGE.low).toBeLessThanOrEqual(DEFAULT_PRICE_RANGE.high);
    expect(A.priceLowPerGbMonth).toBe(DEFAULT_PRICE_RANGE.low);
    expect(A.priceHighPerGbMonth).toBe(DEFAULT_PRICE_RANGE.high);
  });

  it('every entry records where and when it was priced', () => {
    for (const e of PRICES.entries) {
      expect(e.sourceUrl).toMatch(/^https:\/\//);
      expect(e.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.hourlyUsd).toBeGreaterThan(0);
      expect(e.gib).toBeGreaterThan(0);
    }
  });

  it('never uses the disputed GCP figure', () => {
    expect(PRICES.entries.map((e) => e.hourlyUsd)).not.toContain(0.2096);
  });

  it('flags a file older than 60 days as stale', () => {
    expect(isStale('2026-01-01', new Date('2026-03-01T00:00:00Z'))).toBe(false);
    expect(isStale('2026-01-01', new Date('2026-03-03T00:00:00Z'))).toBe(true);
  });
});

describe('cost model', () => {
  it('sizes memory as items x dims x 4 bytes x overhead x headroom', () => {
    expect(memoryNeededGb(1_000_000, 1536, A)).toBeCloseTo((1e6 * 1536 * 4 * 1.5 * 1.3) / 1e9, 10);
  });

  it('keeps low <= mid <= high even when the prices are typed backwards', () => {
    const swapped: Assumptions = { ...A, priceLowPerGbMonth: 9, priceHighPerGbMonth: 3 };
    const c = costRange(10, swapped);
    expect(c.low).toBeLessThanOrEqual(c.mid);
    expect(c.mid).toBeLessThanOrEqual(c.high);
    expect(c.low).toBe(30);
    expect(c.high).toBe(90);
  });

  it('is linear in price', () => {
    const doubled: Assumptions = {
      ...A,
      priceLowPerGbMonth: A.priceLowPerGbMonth * 2,
      priceHighPerGbMonth: A.priceHighPerGbMonth * 2,
    };
    const one = memoryCost(1e6, 1536, A).monthly;
    const two = memoryCost(1e6, 1536, doubled).monthly;
    expect(two.low).toBeCloseTo(one.low * 2, 9);
    expect(two.mid).toBeCloseTo(one.mid * 2, 9);
    expect(two.high).toBeCloseTo(one.high * 2, 9);
  });

  it('is monotonic in items and in dimensions', () => {
    const items = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8].map((n) => memoryCost(n, 1536, A).monthly.mid);
    const dims = [384, 768, 1536, 3072].map((d) => memoryCost(1e6, d, A).monthly.mid);
    for (const series of [items, dims]) {
      for (let i = 1; i < series.length; i += 1) expect(series[i]).toBeGreaterThan(series[i - 1]);
    }
  });

  it('prices the int8 figure from the cost table, vectors only', () => {
    const c = memoryCost(1e6, 1536, A);
    expect(c.int8Gb).toBeCloseTo(1.536, 9);
    expect(c.int8Monthly.mid).toBeCloseTo(costRange(1.536, A).mid, 9);
  });
});

describe('chart series', () => {
  const series = costSeries(1536, A);

  it('runs continuously from 1K to 100M, not at three points', () => {
    expect(series.length).toBeGreaterThan(100);
    expect(series[0].items).toBeCloseTo(1e3, 6);
    expect(series[series.length - 1].items).toBeCloseTo(1e8, 0);
  });

  it('matches the card at any item count on the curve', () => {
    for (const p of series) {
      const c = memoryCost(p.items, 1536, A).monthly;
      expect(p.low).toBeCloseTo(c.low, 9);
      expect(p.mid).toBeCloseTo(c.mid, 9);
      expect(p.high).toBeCloseTo(c.high, 9);
    }
  });

  it('keeps the band ordered', () => {
    for (const p of series) {
      expect(p.low).toBeLessThanOrEqual(p.mid);
      expect(p.mid).toBeLessThanOrEqual(p.high);
    }
  });
});

describe('the estimate does not tilt toward the paid tier', () => {
  it.each<[Tier, boolean]>([
    [0, true],
    [1, false],
    [2, true],
    [3, true],
  ])('tier %i shows an estimate: %s', (tier, shown) => {
    expect(hasMemoryEstimate(tier)).toBe(shown);
  });

  it('prices identically whatever the tier, for the same workload size', () => {
    // Same items and dims, different tiers: the figure depends on the size only.
    const tier0 = w({ items: 1000, dims: 384 });
    const tier2 = w({ items: 1000, dims: 384, tenancy: 'many' });
    expect(decide(tier0, A).tier).toBe(0);
    expect(decide(tier2, A).tier).toBe(2);
    expect(costEstimate(tier0, A, decide(tier0, A))?.today).toEqual(
      costEstimate(tier2, A, decide(tier2, A))?.today,
    );
  });
});

describe('cost inputs travel with the record but not in telemetry', () => {
  const edited: Assumptions = { ...A, priceHighPerGbMonth: 9.5, headroom: 1.6 };

  it('round-trips through the shared link', () => {
    const decoded = decodeState(`?${encodeState(DEFAULT_WORKLOAD, edited).toString()}`);
    expect(decoded.assumptions.priceHighPerGbMonth).toBe(9.5);
    expect(decoded.assumptions.headroom).toBe(1.6);
  });

  it('clamps hostile price values from a link', () => {
    const decoded = decodeState('?a.priceLowPerGbMonth=-4&a.priceHighPerGbMonth=1e9');
    expect(decoded.assumptions.priceLowPerGbMonth).toBeGreaterThan(0);
    expect(decoded.assumptions.priceHighPerGbMonth).toBeLessThanOrEqual(100);
  });

  it('puts the estimate and the new assumptions in the JSON record', () => {
    const d = decide(DEFAULT_WORKLOAD, edited);
    const json = decisionRecordJson(DEFAULT_WORKLOAD, edited, d, 'https://example.test/');
    expect(json.costEstimate?.today.monthly.high).toBeCloseTo(
      memoryCost(DEFAULT_WORKLOAD.items, DEFAULT_WORKLOAD.dims, edited).monthly.high,
      9,
    );
    expect(json.assumptions.headroom).toBe(1.6);
    expect(json.assumptionsChanged).toEqual(
      expect.arrayContaining(['priceHighPerGbMonth', 'headroom']),
    );
  });

  it('puts the estimate and the new assumptions in the Markdown record', () => {
    const d = decide(DEFAULT_WORKLOAD, edited);
    const md = decisionRecordMarkdown(DEFAULT_WORKLOAD, edited, d, 'https://example.test/');
    expect(md).toContain('## Memory cost estimate');
    expect(md).toContain('Not a quote');
    expect(md).toContain('| priceHighPerGbMonth | 9.5 | yes |');
    expect(md).toContain('| headroom | 1.6 | yes |');
  });

  it('says why there is no estimate for tier 1', () => {
    const exact = w({ matching: 'exact' });
    const md = decisionRecordMarkdown(exact, A, decide(exact, A), 'https://example.test/');
    expect(md).toContain('Full-text indexes are small');
    expect(decisionRecordJson(exact, A, decide(exact, A), 'x').costEstimate).toBeNull();
  });

  it('never sends cost inputs in telemetry, not even their names', () => {
    const p = buildPayload(DEFAULT_WORKLOAD, edited, decide(DEFAULT_WORKLOAD, edited), 'organic');
    for (const k of COST_ASSUMPTIONS) expect(p.assumptionsChanged).not.toContain(k);
    expect(JSON.stringify(p)).not.toMatch(/price|headroom|9\.5/i);
  });
});
