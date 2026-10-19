import { changedAssumptions, DEFAULT_ASSUMPTIONS } from './assumptions';
import { footprint, itemsAfterGrowth } from './compute';
import { TIER_COPY } from './decision';
import { bytesLabel, compactItems, fullItems, scanLabel } from './format';
import type { Assumptions, Decision, Workload } from './types';

/**
 * Turns a result into something you can paste into an ADR, a ticket or an RFC.
 *
 * The record carries the assumptions actually used, not the shipped defaults,
 * so a reviewer can see whether the author calibrated the model or took it as
 * delivered.
 */

const LATENCY_LABEL: Record<number, string> = {
  0: 'no target',
  10: 'under 10ms',
  50: 'under 50ms',
  200: 'under 200ms',
};

const QPS_LABEL: Record<number, string> = {
  1: 'under 1',
  10: '1 to 10',
  100: '10 to 100',
  101: 'over 100',
};

const RESIDENCY_LABEL: Record<string, string> = {
  cloud: 'any cloud',
  onprem: 'own servers',
  airgapped: 'air-gapped',
  edge: 'on-device or edge',
};

const MATCHING_LABEL: Record<string, string> = {
  semantic: 'meaning',
  exact: 'exact terms',
  hybrid: 'both',
};

export function decisionRecordMarkdown(
  w: Workload,
  a: Assumptions,
  d: Decision,
  shareUrl: string,
  now = new Date(),
): string {
  const copy = TIER_COPY[d.tier];
  const today = footprint(w.items, w.dims, a);
  const next = footprint(d.items12, w.dims, a);
  const overrides = changedAssumptions(a);

  const lines: string[] = [];

  lines.push(`# Vector store sizing decision`);
  lines.push('');
  lines.push(`**Verdict:** ${copy.headline} (${copy.badge})`);
  lines.push('');
  lines.push(copy.lede);
  lines.push('');

  lines.push(`## Workload`);
  lines.push('');
  lines.push('| Input | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Items today | ${fullItems(w.items)} |`);
  lines.push(`| Growth over 12 months | ${w.growth}x |`);
  lines.push(`| Items in 12 months | ${fullItems(d.items12)} |`);
  lines.push(`| Embedding dimensions | ${w.dims} |`);
  lines.push(`| Latency target | ${LATENCY_LABEL[w.latencyMs] ?? '-'} |`);
  lines.push(`| Peak queries per second | ${QPS_LABEL[w.qps] ?? '-'} |`);
  lines.push(`| Metadata filtering | ${w.filtering} |`);
  lines.push(`| Matching | ${MATCHING_LABEL[w.matching] ?? w.matching} |`);
  lines.push(`| Data change rate | ${w.changeRate} |`);
  lines.push(`| Tenancy | ${w.tenancy === 'many' ? 'many tenants share one store' : 'one workspace'} |`);
  lines.push(`| Data residency | ${RESIDENCY_LABEL[w.residency] ?? w.residency} |`);
  lines.push(`| Already running Postgres | ${w.postgres ? 'yes' : 'no'} |`);
  lines.push('');

  lines.push(`## Why`);
  lines.push('');
  d.reasons.forEach((r) => lines.push(`- ${r.text}`));
  lines.push('');
  lines.push(`**What would change this.** ${d.whatWouldChange}`);
  lines.push('');

  if (d.considerations.length > 0) {
    // A reviewer's first objection is usually "but Postgres does that". The
    // record answers it in advance rather than leaving the demand unmentioned.
    lines.push(`## Also weighed, and not grounds on their own`);
    lines.push('');
    d.considerations.forEach((c) => lines.push(`- **${c.text}** ${c.handledBy}`));
    lines.push('');
  }

  lines.push(`## Cost of the data`);
  lines.push('');
  lines.push('| Measure | Today | In 12 months |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| Vector memory, float32 | ${bytesLabel(today.float32Bytes)} | ${bytesLabel(next.float32Bytes)} |`,
  );
  lines.push(
    `| Same vectors at int8 | ${bytesLabel(today.int8Bytes)} | ${bytesLabel(next.int8Bytes)} |`,
  );
  lines.push(
    `| Comparisons per query | ${compactItems(today.comparisons)} | ${compactItems(next.comparisons)} |`,
  );
  lines.push(
    `| Brute-force scan | ${scanLabel(today.scanMsLow, today.scanMsHigh)} | ${scanLabel(next.scanMsLow, next.scanMsHigh)} |`,
  );
  lines.push('');
  lines.push(
    'Memory and comparison counts are exact arithmetic for these inputs. The scan figure is an order of magnitude, not a measurement.',
  );
  lines.push('');

  lines.push(`## Assumptions used`);
  lines.push('');
  if (overrides.length === 0) {
    lines.push('Shipped defaults, unchanged. These are rule-of-thumb estimates rather than benchmark results, so calibrate them against your own hardware before treating a near-boundary result as settled.');
  } else {
    lines.push('Values marked changed were overridden by the author.');
  }
  lines.push('');
  lines.push('| Assumption | Value | Changed |');
  lines.push('| --- | --- | --- |');
  (Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]).forEach((k) => {
    const changed = a[k] !== DEFAULT_ASSUMPTIONS[k];
    lines.push(`| ${k} | ${fullItems(a[k])} | ${changed ? 'yes' : 'no'} |`);
  });
  lines.push('');

  lines.push(`## Provenance`);
  lines.push('');
  lines.push(`- Generated ${now.toISOString().slice(0, 10)}`);
  lines.push(`- Reproduce: ${shareUrl}`);
  lines.push(
    '- Tool: Actian VectorAI DB sizing calculator. The tier break points are guidance, not a benchmark.',
  );
  lines.push('');

  return lines.join('\n');
}

export interface DecisionRecordJson {
  generatedAt: string;
  verdict: { tier: number; headline: string };
  workload: Workload;
  assumptions: Assumptions;
  assumptionsChanged: string[];
  reasons: string[];
  considerations: { text: string; handledBy: string }[];
  whatWouldChange: string;
  footprint: {
    today: ReturnType<typeof footprint>;
    inTwelveMonths: ReturnType<typeof footprint>;
  };
  shareUrl: string;
}

export function decisionRecordJson(
  w: Workload,
  a: Assumptions,
  d: Decision,
  shareUrl: string,
  now = new Date(),
): DecisionRecordJson {
  return {
    generatedAt: now.toISOString(),
    verdict: { tier: d.tier, headline: TIER_COPY[d.tier].headline },
    workload: w,
    assumptions: a,
    assumptionsChanged: changedAssumptions(a),
    reasons: d.reasons.map((r) => r.text),
    considerations: d.considerations.map((c) => ({ text: c.text, handledBy: c.handledBy })),
    whatWouldChange: d.whatWouldChange,
    footprint: {
      today: footprint(w.items, w.dims, a),
      inTwelveMonths: footprint(itemsAfterGrowth(w), w.dims, a),
    },
    shareUrl,
  };
}
