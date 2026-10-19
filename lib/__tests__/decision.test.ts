import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../assumptions';
import { decide } from '../decision';
import { DEFAULT_WORKLOAD } from '../urlState';
import type { Tier, Workload } from '../types';

const w = (over: Partial<Workload> = {}): Workload => ({ ...DEFAULT_WORKLOAD, ...over });
const tierOf = (over: Partial<Workload> = {}, a = DEFAULT_ASSUMPTIONS): Tier =>
  decide(w(over), a).tier;

describe('tier outcomes', () => {
  it('leaves a tiny quiet workload on a flat file', () => {
    expect(tierOf({ items: 1_000 })).toBe(0);
  });

  it('keeps 100K under a 50ms target on a flat scan', () => {
    expect(tierOf({ items: 100_000, latencyMs: 50 })).toBe(0);
  });

  it('does not force a dedicated store for on-premises alone', () => {
    // pgvector runs perfectly well on your own hardware. Only air-gapped and
    // edge are genuine drivers.
    expect(tierOf({ items: 10_000, residency: 'onprem' })).toBe(0);
  });

  it('moves to an index when the latency target tightens', () => {
    expect(tierOf({ items: 100_000, latencyMs: 10 })).toBe(2);
  });

  it('answers exact-term matching with a keyword index at any scale', () => {
    expect(tierOf({ items: 1_000_000, matching: 'exact' })).toBe(1);
    expect(tierOf({ items: 1_000, matching: 'exact' })).toBe(1);
  });

  it('keeps light filtering at small scale on pgvector', () => {
    expect(tierOf({ items: 10_000, filtering: 'always' })).toBe(2);
  });

  it.each<[string, Partial<Workload>]>([
    ['hybrid matching', { matching: 'hybrid' }],
    ['air-gapped residency', { residency: 'airgapped' }],
    ['edge residency', { residency: 'edge' }],
    ['many tenants', { tenancy: 'many' }],
    ['constant churn', { changeRate: 'constant' }],
    ['always filtering at 1M', { items: 1_000_000, filtering: 'always' }],
    ['10M items', { items: 10_000_000 }],
    ['1M with 10x growth', { items: 1_000_000, growth: 10 }],
  ])('needs a dedicated store for %s', (_label, over) => {
    expect(tierOf(over)).toBe(3);
  });

  it('does not escalate purely because load is high', () => {
    // 1M at a relaxed target is still pgvector territory even when busy.
    expect(tierOf({ items: 1_000_000, latencyMs: 200, qps: 101 })).toBe(2);
    // Tightening the target to 10ms under that load is what tips it.
    expect(tierOf({ items: 1_000_000, latencyMs: 10, qps: 101 })).toBe(3);
  });
});

describe('the lower tiers stay reachable', () => {
  // Guards hard rule 3 in AGENTS.md. The tool is credible because it sometimes
  // says no. If these fail because thresholds were tuned toward the paid tier,
  // the guardrail is working. Do not loosen the assertions.
  it('reaches tier 0 on the shipped defaults', () => {
    expect(tierOf()).toBe(0);
  });

  it('reaches tier 1 on the shipped defaults', () => {
    expect(tierOf({ matching: 'exact' })).toBe(1);
  });

  it('does not put a default workload on tier 3', () => {
    expect(tierOf()).not.toBe(3);
  });
});

describe('reasons', () => {
  it('always explains itself', () => {
    const d = decide(w({ residency: 'airgapped' }), DEFAULT_ASSUMPTIONS);
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.reasons[0].text).toContain('air-gapped');
  });

  it('cites the assumption a threshold-driven reason depends on', () => {
    const d = decide(w({ items: 10_000_000 }), DEFAULT_ASSUMPTIONS);
    const past = d.reasons.find((r) => r.id === 'past-pgvector');
    expect(past?.dependsOn).toContain('pgvectorCeiling');
  });

  it('gives a way back for every tier 3 verdict', () => {
    const d = decide(w({ tenancy: 'many' }), DEFAULT_ASSUMPTIONS);
    expect(d.whatWouldChange.length).toBeGreaterThan(10);
  });
});

describe('assumptions actually drive the result', () => {
  it('raising the pgvector ceiling keeps a large workload off tier 3', () => {
    const big = w({ items: 10_000_000 });
    expect(decide(big, DEFAULT_ASSUMPTIONS).tier).toBe(3);
    const relaxed = { ...DEFAULT_ASSUMPTIONS, pgvectorCeiling: 100_000_000 };
    expect(decide(big, relaxed).tier).toBe(2);
  });

  it('lowering the flat ceiling pushes a small workload off tier 0', () => {
    const small = w({ items: 100_000, latencyMs: 50 });
    expect(decide(small, DEFAULT_ASSUMPTIONS).tier).toBe(0);
    const strict = { ...DEFAULT_ASSUMPTIONS, flatScanUnder50ms: 1_000 };
    expect(decide(small, strict).tier).toBe(2);
  });

  it('reports the flat ceiling implied by the chosen latency target', () => {
    expect(decide(w({ latencyMs: 10 }), DEFAULT_ASSUMPTIONS).flatCeiling).toBe(10_000);
    expect(decide(w({ latencyMs: 200 }), DEFAULT_ASSUMPTIONS).flatCeiling).toBe(1_000_000);
    // "Does not matter" uses the same practical ceiling as the 200ms target.
    expect(decide(w({ latencyMs: 0 }), DEFAULT_ASSUMPTIONS).flatCeiling).toBe(1_000_000);
  });
});

describe('growth', () => {
  it('decides on the twelve-month count, not today', () => {
    expect(tierOf({ items: 1_000_000, growth: 1, latencyMs: 200 })).toBe(0);
    expect(tierOf({ items: 1_000_000, growth: 10, latencyMs: 200 })).toBe(3);
  });

  it('exposes the projected count', () => {
    expect(decide(w({ items: 100_000, growth: 10 }), DEFAULT_ASSUMPTIONS).items12).toBe(
      1_000_000,
    );
  });
});
