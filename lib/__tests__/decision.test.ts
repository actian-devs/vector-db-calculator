import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../assumptions';
import { flatCeiling, footprint, pgvectorCeiling, scanMs } from '../compute';
import { decide, stackingGate } from '../decision';
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
 * Verdicts from the pre-launch QA audit that a skeptical engineer would have
 * called vendor bias, or where the page contradicted itself.
 */
describe('QA audit verdicts stay fixed', () => {
  const userLink: Partial<Workload> = {
    items: 100_000,
    growth: 100,
    dims: 3072,
    latencyMs: 200,
    qps: 101,
    filtering: 'always',
    matching: 'hybrid',
    changeRate: 'append',
    tenancy: 'many',
    residency: 'airgapped',
    postgres: false,
  };

  it.each<[string, Partial<Workload>]>([
    ['40K, hybrid and many tenants at 10ms', { items: 40_000, matching: 'hybrid', tenancy: 'many', latencyMs: 10 }],
    ['200K, hybrid and many tenants', { items: 100_000, growth: 2, matching: 'hybrid', tenancy: 'many' }],
    ['200K, churn and many tenants', { items: 100_000, growth: 2, changeRate: 'constant', tenancy: 'many' }],
    ['1.2M, always-on filtering alone', { items: 1_200_000, filtering: 'always' }],
    ['2M x 384, always-on filtering, on Postgres', { items: 2_000_000, dims: 384, filtering: 'always', postgres: true }],
  ])('%s stays on Postgres', (_label, over) => {
    expect(tierOf(over)).toBe(2);
  });

  it('escalates filtering plus hybrid at 2M x 1536 and names both', () => {
    const d = decide(w({ items: 2_000_000, filtering: 'always', matching: 'hybrid' }), DEFAULT_ASSUMPTIONS);
    expect(d.tier).toBe(3);
    expect(d.stacked).toEqual(['hybrid', 'filtering']);
    expect(d.reasons.find((r) => r.id === 'stacked-demands')?.text).toMatch(
      /hybrid search and always-on filtering/,
    );
  });

  it('keeps three stacked demands at 2M on Postgres at tier 3', () => {
    expect(
      tierOf({ items: 2_000_000, matching: 'hybrid', tenancy: 'many', changeRate: 'constant', postgres: true }),
    ).toBe(3);
  });

  it('keeps the user link at tier 3, without claiming one change is enough', () => {
    const d = decide(w(userLink), DEFAULT_ASSUMPTIONS);
    expect(d.tier).toBe(3);
    expect(d.reasons.map((r) => r.id)).toEqual(['past-pgvector', 'stacked-demands']);
    expect(d.whatWouldChange).toMatch(/only if/);
    expect(d.whatWouldChange).toMatch(/184GB/);
    expect(d.whatWouldChange).toMatch(/, and also /);
    expect(d.whatWouldChange).not.toMatch(/^If you drop the always-on metadata filter/);
  });

  it('lets the heavy-filtering assumption take filtering out of the stack', () => {
    const over = { items: 2_000_000, filtering: 'always', matching: 'hybrid' } as const;
    expect(tierOf(over)).toBe(3);
    expect(tierOf(over, { ...DEFAULT_ASSUMPTIONS, heavyFilterCeiling: 5_000_000 })).toBe(2);
  });

  it('moves the stacking gate with its assumption', () => {
    const over = { items: 1_000_000, matching: 'hybrid', tenancy: 'many' } as const;
    expect(tierOf(over)).toBe(2);
    expect(tierOf(over, { ...DEFAULT_ASSUMPTIONS, stackingGateFraction: 0.2 })).toBe(3);
    expect(stackingGate(w(over), DEFAULT_ASSUMPTIONS)).toBeGreaterThan(1_700_000);
  });

  it('points hybrid search on a flat file at a keyword index too', () => {
    const d = decide(w({ items: 10_000, matching: 'hybrid' }), DEFAULT_ASSUMPTIONS);
    expect(d.tier).toBe(0);
    expect(d.reasons.map((r) => r.id)).toContain('hybrid-keyword');
  });

  it('says why a small workload is not on a flat file', () => {
    const d = decide(w({ items: 10_000, qps: 101, latencyMs: 10 }), DEFAULT_ASSUMPTIONS);
    expect(d.tier).toBe(2);
    expect(d.reasons.find((r) => r.id === 'needs-index')?.text).toMatch(/over 100 queries per second/);
  });

  it('gives edge workloads an embedded-store headline at tier 3', () => {
    const d = decide(w({ items: 10_000_000, dims: 768, residency: 'edge' }), DEFAULT_ASSUMPTIONS);
    expect(d.tier).toBe(3);
    expect(d.copy.headline).toMatch(/embedded/);
  });

  it('still bounds a flat scan when latency does not matter', () => {
    const d = decide(w({ items: 1_000_000, dims: 1536, latencyMs: 0 }), DEFAULT_ASSUMPTIONS);
    expect(d.tier).toBe(0);
    expect(d.reasons.map((r) => r.id)).toContain('marginal-hardware');
    expect(tierOf({ items: 10_000_000, dims: 1536, latencyMs: 0, growth: 1 }, { ...DEFAULT_ASSUMPTIONS, ramBudgetGb: 128 })).toBe(2);
  });

  it('lists high query load as a consideration', () => {
    const d = decide(w({ items: 1_000_000, qps: 101, latencyMs: 10 }), DEFAULT_ASSUMPTIONS);
    expect(d.considerations.map((c) => c.id)).toContain('qps');
  });
});

/**
 * Hard rule 7: air-gapped is never a reason at any scale. It must not sneak in
 * through the stacked-demands count either, since the consideration's own prose
 * says the network boundary is not an argument for any particular database.
 * 2M x 1536 at 200ms sits past the flat ceiling, past the stacking gate and
 * under the pgvector ceiling, which is exactly where stacking decides the tier.
 */
describe('air-gapped never counts toward escalation', () => {
  const stackable = { items: 2_000_000, dims: 1536, latencyMs: 200 } as const;

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

  it('does not let edge and air-gapped stack with one real demand', () => {
    const base = { ...stackable, matching: 'hybrid', postgres: false } as const;
    // Otherwise tier 2, so this isolates the effect of the two deployment flags.
    expect(tierOf(base)).toBe(2);
    expect(tierOf({ ...base, residency: 'edge' })).toBe(2);
    expect(tierOf({ ...base, residency: 'airgapped' })).toBe(2);
  });

  it('keeps edge visible as a consideration', () => {
    const d = decide(w({ ...stackable, residency: 'edge' }), DEFAULT_ASSUMPTIONS);
    expect(d.considerations.map((c) => c.id)).toContain('edge');
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
    expect(stacked?.text).toMatch(/^hybrid search and many tenants stack/);
    expect(stacked?.text).not.toMatch(/air/);
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
    items: 2_000_000,
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

describe('deployment note', () => {
  const shapes: Partial<Workload>[] = [
    { items: 10_000, dims: 384 },
    { items: 2_000_000, dims: 384, latencyMs: 50 },
    { items: 1_000_000, growth: 2, matching: 'hybrid', tenancy: 'many' },
  ];
  const residencies = ['cloud', 'onprem', 'airgapped', 'edge'] as const;

  it('never changes the tier', () => {
    for (const shape of shapes) {
      const base = tierOf({ ...shape, residency: 'cloud' });
      for (const residency of residencies) expect(tierOf({ ...shape, residency })).toBe(base);
    }
  });

  it('shows only for air-gapped and edge', () => {
    for (const shape of shapes) {
      for (const residency of residencies) {
        const note = decide(w({ ...shape, residency }), DEFAULT_ASSUMPTIONS).deploymentNote;
        if (residency === 'cloud' || residency === 'onprem') expect(note).toBeNull();
        else expect(note).toBeTruthy();
      }
    }
  });

  it('points edge at an embedded store at tier 2, without changing the tier', () => {
    const d = decide(w({ ...shapes[1], residency: 'edge' }), DEFAULT_ASSUMPTIONS);
    expect(d.tier).toBe(2);
    expect(d.copy.headline).toBe('pgvector will carry you for now');
    expect(d.deploymentNote).toMatch(/embedded store/);
  });
});
