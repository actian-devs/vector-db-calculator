import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../assumptions';
import { flatCeiling, footprint, pgvectorCeiling, scanMs } from '../compute';
import { decide } from '../decision';
import { DEFAULT_WORKLOAD } from '../urlState';
import type { Tier, Workload } from '../types';

const w = (over: Partial<Workload> = {}): Workload => ({ ...DEFAULT_WORKLOAD, ...over });
const tierOf = (over: Partial<Workload> = {}, a = DEFAULT_ASSUMPTIONS): Tier =>
  decide(w(over), a).tier;

/**
 * The cases in this block come from engineering review of the live tool. Each
 * one is something a reader could have challenged us on in public. They are the
 * reason the ceilings are derived rather than asserted, so do not replace them
 * with fixed thresholds.
 */
describe('review findings stay fixed', () => {
  it('never claims a flat scan meets a target the scan estimate misses', () => {
    // The original bug: the page printed "0.31 to 3.1s" for 1M x 1536 and said
    // a flat scan met a 200ms target on the same screen.
    const cases: Workload[] = [
      w({ items: 1_000_000, dims: 1536, latencyMs: 200 }),
      w({ items: 1_000_000, dims: 3072, latencyMs: 200 }),
      w({ items: 100_000, dims: 1536, latencyMs: 10 }),
      w({ items: 5_000_000, dims: 768, latencyMs: 50 }),
    ];
    for (const workload of cases) {
      const d = decide(workload, DEFAULT_ASSUMPTIONS);
      if (d.tier !== 0) continue;
      const best = scanMs(d.items12, workload.dims, DEFAULT_ASSUMPTIONS.gflopsHigh);
      expect(best).toBeLessThanOrEqual(workload.latencyMs);
    }
  });

  it('does not put 1M x 1536 on a flat scan at a 200ms target', () => {
    expect(tierOf({ items: 1_000_000, dims: 1536, latencyMs: 200 })).not.toBe(0);
  });

  it('lets dimensions change the verdict at a fixed item count', () => {
    // Same count, a quarter of the work. The old fixed thresholds could not
    // tell these apart.
    // 1M at 384 scans in ~77ms; the same count at 3072 takes ~614ms.
    const small = tierOf({ items: 1_000_000, dims: 384, latencyMs: 200 });
    const large = tierOf({ items: 1_000_000, dims: 3072, latencyMs: 200 });
    expect(small).toBe(0);
    expect(large).not.toBe(0);
  });

  it('scales the pgvector ceiling with memory and dimensions, not a fixed 1M', () => {
    // A reader who has run more than a million vectors on pgvector is right,
    // and the tool now agrees with them when the hardware supports it.
    expect(tierOf({ items: 3_000_000, dims: 768, latencyMs: 50 })).toBe(2);
    expect(pgvectorCeiling(w({ dims: 1536 }), DEFAULT_ASSUMPTIONS)).toBeGreaterThan(1_000_000);
    // More memory pushes it further out.
    const bigger = { ...DEFAULT_ASSUMPTIONS, ramBudgetGb: 256 };
    expect(pgvectorCeiling(w({ dims: 1536 }), bigger)).toBeGreaterThan(
      pgvectorCeiling(w({ dims: 1536 }), DEFAULT_ASSUMPTIONS),
    );
  });

  it('matches the stated ceiling to the memory arithmetic', () => {
    const a = DEFAULT_ASSUMPTIONS;
    const ceiling = pgvectorCeiling(w({ dims: 1536 }), a);
    const indexBytes = ceiling * 1536 * a.bytesPerComponentF32 * a.hnswMemoryOverhead;
    expect(indexBytes / 1e9).toBeCloseTo(a.ramBudgetGb, 6);
  });
});

/**
 * Hard rule 7: air-gapped is never a reason at any scale. It must not sneak in
 * through the stacked-demands count either, since the consideration's own prose
 * says the network boundary is not an argument for any particular database.
 * 1M x 1536 at 200ms sits past the flat ceiling and under the pgvector ceiling,
 * which is exactly where stacking decides the tier.
 */
describe('air-gapped never counts toward escalation', () => {
  const stackable = { items: 1_000_000, dims: 1536, latencyMs: 200 } as const;

  it('does not escalate air-gapped plus one other demand', () => {
    expect(
      tierOf({ ...stackable, residency: 'airgapped', matching: 'hybrid', postgres: false }),
    ).not.toBe(3);
  });

  it('does not let air-gapped tip an existing Postgres user over the bar', () => {
    expect(
      tierOf({
        ...stackable,
        residency: 'airgapped',
        matching: 'hybrid',
        tenancy: 'many',
        postgres: true,
      }),
    ).not.toBe(3);
  });

  it('still escalates when real demands stack', () => {
    expect(tierOf({ ...stackable, matching: 'hybrid', tenancy: 'many', postgres: false })).toBe(3);
  });

  it('never names air-gapped in the reasons for a tier 3 verdict', () => {
    const d = decide(
      w({ ...stackable, residency: 'airgapped', matching: 'hybrid', tenancy: 'many', postgres: false }),
      DEFAULT_ASSUMPTIONS,
    );
    expect(d.tier).toBe(3);
    const stacked = d.reasons.find((r) => r.id === 'stacked-demands');
    expect(stacked?.text).toMatch(/^2 operational demands/);
  });
});

/**
 * No single capability forces a dedicated store. Postgres does all of these,
 * and treating any of them as an automatic escalation is vendor bias rather
 * than engineering.
 */
describe('no capability alone forces a dedicated store', () => {
  it.each<[string, Partial<Workload>]>([
    ['hybrid search', { matching: 'hybrid' }],
    ['many tenants', { tenancy: 'many' }],
    ['constant churn', { changeRate: 'constant' }],
    ['air-gapped deployment', { residency: 'airgapped' }],
    ['edge deployment', { residency: 'edge' }],
    ['always filtering, at modest scale', { filtering: 'always' }],
  ])('%s on a small workload does not reach tier 3', (_label, over) => {
    expect(tierOf({ items: 10_000, dims: 384, ...over })).not.toBe(3);
  });

  it('air-gapped is never a reason on its own, at any scale', () => {
    // Postgres self-hosts with no outbound dependency, so the network boundary
    // is not an argument for a commercial database.
    const d = decide(w({ items: 100_000, dims: 384, residency: 'airgapped' }), DEFAULT_ASSUMPTIONS);
    expect(d.tier).not.toBe(3);
    expect(d.reasons.some((r) => r.id === 'airgapped')).toBe(false);
  });

  it('surfaces the demand as a consideration instead of hiding it', () => {
    const d = decide(w({ matching: 'hybrid' }), DEFAULT_ASSUMPTIONS);
    const hybrid = d.considerations.find((c) => c.id === 'hybrid');
    expect(hybrid).toBeDefined();
    expect(hybrid!.handledBy).toMatch(/Postgres/);
  });

  it('escalates when demands stack on a workload that is already large', () => {
    expect(
      tierOf({
        items: 2_000_000,
        dims: 1536,
        matching: 'hybrid',
        tenancy: 'many',
        changeRate: 'constant',
        postgres: false,
      }),
    ).toBe(3);
  });
});

describe('running Postgres already changes the recommendation', () => {
  const stacked: Partial<Workload> = {
    items: 400_000,
    dims: 1536,
    latencyMs: 50,
    matching: 'hybrid',
    tenancy: 'many',
  };

  it('raises the bar to leave a database you already operate', () => {
    expect(tierOf({ ...stacked, postgres: true })).toBe(2);
    expect(tierOf({ ...stacked, postgres: false })).toBe(3);
  });
});

describe('tier outcomes', () => {
  it('leaves a genuinely small workload on a flat file', () => {
    expect(tierOf({ items: 1_000, dims: 384 })).toBe(0);
  });

  it('answers exact-term matching with a keyword index at any scale', () => {
    expect(tierOf({ items: 50_000_000, matching: 'exact' })).toBe(1);
    expect(tierOf({ items: 1_000, matching: 'exact' })).toBe(1);
  });

  it('moves past a flat scan when the latency target tightens', () => {
    // 500K at 384 scans in ~38ms: fine for 200ms, not for 10ms.
    expect(tierOf({ items: 500_000, dims: 384, latencyMs: 200 })).toBe(0);
    expect(tierOf({ items: 500_000, dims: 384, latencyMs: 10 })).toBe(2);
  });

  it('decides on the twelve-month count rather than today', () => {
    expect(tierOf({ items: 100_000, dims: 384, growth: 1, latencyMs: 200 })).toBe(0);
    expect(tierOf({ items: 100_000, dims: 384, growth: 100, latencyMs: 200 })).toBe(2);
  });

  it('warns when a flat scan only holds on favourable hardware', () => {
    const d = decide(w({ items: 100_000, dims: 1536, latencyMs: 50 }), DEFAULT_ASSUMPTIONS);
    expect(d.tier).toBe(0);
    expect(d.reasons.some((r) => r.id === 'marginal-hardware')).toBe(true);
  });
});

describe('the lower tiers stay reachable', () => {
  // Guards hard rule 3 in AGENTS.md. The tool is credible because it sometimes
  // says no. Do not loosen these.
  it('reaches tier 0', () => {
    expect(tierOf({ items: 10_000, dims: 384 })).toBe(0);
  });

  it('reaches tier 1', () => {
    expect(tierOf({ matching: 'exact' })).toBe(1);
  });

  it('reaches tier 2 without any operational demands', () => {
    expect(tierOf({ items: 2_000_000, dims: 384, latencyMs: 50 })).toBe(2);
  });
});

describe('reasons and assumptions', () => {
  it('always explains itself', () => {
    const d = decide(w({ items: 50_000_000, dims: 1536 }), DEFAULT_ASSUMPTIONS);
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.reasons[0].text).toMatch(/GB/);
  });

  it('cites the assumption a threshold-driven reason depends on', () => {
    const d = decide(w({ items: 50_000_000, dims: 1536 }), DEFAULT_ASSUMPTIONS);
    expect(d.reasons.find((r) => r.id === 'past-pgvector')?.dependsOn).toContain('ramBudgetGb');
  });

  it('raising the memory budget keeps a large workload on Postgres', () => {
    const big = w({ items: 20_000_000, dims: 1536, latencyMs: 50 });
    expect(decide(big, DEFAULT_ASSUMPTIONS).tier).toBe(3);
    expect(decide(big, { ...DEFAULT_ASSUMPTIONS, ramBudgetGb: 512 }).tier).toBe(2);
  });

  it('gives a way back for every tier 3 verdict', () => {
    const d = decide(w({ items: 50_000_000, dims: 1536 }), DEFAULT_ASSUMPTIONS);
    expect(d.whatWouldChange.length).toBeGreaterThan(10);
  });

  it('reports a flat ceiling consistent with the footprint shown', () => {
    const workload = w({ dims: 1536, latencyMs: 200 });
    const ceiling = flatCeiling(workload, DEFAULT_ASSUMPTIONS);
    const f = footprint(ceiling, workload.dims, DEFAULT_ASSUMPTIONS);
    expect(f.scanMsLow).toBeCloseTo(200, 6);
  });
});
