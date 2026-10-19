import { flatCeiling, itemsAfterGrowth } from './compute';
import { compactItems } from './format';
import type { Assumptions, Decision, Reason, Tier, TierCopy, Workload } from './types';

/**
 * The decision model.
 *
 * Pure and framework-free. Given a workload and a set of assumptions it returns
 * one tier plus the reasons behind it.
 *
 * Editorial constraint, see AGENTS.md: tiers 0 and 1 are real outcomes. Do not
 * tune thresholds so that more workloads land on tier 3. The unit tests assert
 * the lower tiers stay reachable.
 */

export const TIER_COPY: Record<Tier, TierCopy> = {
  0: {
    badge: 'TIER 0',
    headline: "You don't need a vector database yet",
    lede: 'A flat file and an in-memory cosine scan covers this. Add the dependency when the numbers move, not before.',
  },
  1: {
    badge: 'TIER 1',
    headline: 'You need keyword search, not vectors',
    lede: 'BM25 through SQLite FTS or Postgres full-text answers exact-term queries faster and more precisely than embeddings will.',
  },
  2: {
    badge: 'TIER 2',
    headline: 'pgvector will carry you for now',
    lede: 'An HNSW index on Postgres handles this shape of workload without a second system to run.',
  },
  3: {
    badge: 'TIER 3',
    headline: 'You need a dedicated vector database',
    lede: 'This is where a dedicated store earns its place, because of how your workload filters, scales or has to be deployed.',
  },
};

function reason(
  id: string,
  text: string,
  dependsOn?: (keyof Assumptions)[],
): Reason {
  return dependsOn ? { id, text, dependsOn } : { id, text };
}

export function decide(w: Workload, a: Assumptions): Decision {
  const items12 = itemsAfterGrowth(w);
  const ceiling = flatCeiling(w, a);
  const busy = w.qps >= 100;
  const reasons: Reason[] = [];

  // Exact-term matching is answered by a keyword index whatever the scale,
  // so it short-circuits before any vector consideration.
  if (w.matching === 'exact') {
    reasons.push(
      reason(
        'exact-matching',
        'you match exact terms rather than meaning, which is what a keyword index is for',
      ),
    );
    if (items12 > a.pgvectorCeiling) {
      reasons.push(
        reason(
          'fts-scales',
          `full-text indexes stay fast at ${compactItems(items12)} items`,
        ),
      );
    }
    return finish(1, items12, ceiling, reasons, w, a);
  }

  if (w.residency === 'airgapped') {
    reasons.push(
      reason('airgapped', 'your data has to stay inside an air-gapped network'),
    );
  }
  if (w.residency === 'edge') {
    reasons.push(reason('edge', 'this runs on edge or on-device hardware'));
  }
  if (w.matching === 'hybrid') {
    reasons.push(
      reason('hybrid', 'you need keyword and semantic search together'),
    );
  }
  if (w.tenancy === 'many') {
    reasons.push(
      reason(
        'multi-tenant',
        'many tenants share one store, so you need isolation per tenant',
      ),
    );
  }
  if (w.changeRate === 'constant') {
    reasons.push(
      reason('churn', 'the data changes constantly, with updates and deletes'),
    );
  }
  if (w.filtering === 'always' && items12 > a.heavyFilterCeiling) {
    reasons.push(
      reason(
        'heavy-filter',
        `you always filter by metadata, at ${compactItems(items12)} items`,
        ['heavyFilterCeiling'],
      ),
    );
  }
  if (w.filtering === 'sometimes' && items12 > a.pgvectorCeiling) {
    reasons.push(
      reason(
        'filter-at-scale',
        `you filter by metadata past ${compactItems(a.pgvectorCeiling)} items`,
        ['pgvectorCeiling'],
      ),
    );
  }
  if (items12 > a.pgvectorCeiling) {
    reasons.push(
      reason(
        'past-pgvector',
        `${compactItems(items12)} items within 12 months is past the practical single-Postgres guide`,
        ['pgvectorCeiling'],
      ),
    );
  }
  if (items12 > ceiling && w.latencyMs !== 0 && busy) {
    reasons.push(
      reason(
        'latency-under-load',
        `a ${w.latencyMs}ms target at ${compactItems(items12)} items with real concurrency needs an index`,
        ['flatScanUnder10ms', 'flatScanUnder50ms', 'flatScanUnder200ms'],
      ),
    );
  }

  if (reasons.length > 0) return finish(3, items12, ceiling, reasons, w, a);

  const quiet = w.qps <= 10;
  if (
    items12 <= ceiling &&
    quiet &&
    w.filtering === 'never' &&
    w.tenancy === 'single'
  ) {
    reasons.push(
      reason(
        'fits-flat',
        `${compactItems(items12)} items fits a flat in-memory scan at your ${
          w.latencyMs === 0 ? 'relaxed latency' : `under ${w.latencyMs}ms`
        } target`,
        ['flatScanUnder10ms', 'flatScanUnder50ms', 'flatScanUnder200ms'],
      ),
    );
    reasons.push(
      reason(
        'nothing-to-index',
        'no metadata filtering and a single workspace, so there is nothing to index around',
      ),
    );
    if (w.qps <= 1) {
      reasons.push(
        reason(
          'no-concurrency',
          'under one query per second, so concurrency is not a factor',
        ),
      );
    }
    return finish(0, items12, ceiling, reasons, w, a);
  }

  reasons.push(
    reason(
      'within-hnsw',
      `${compactItems(items12)} items is within reach of an HNSW index on Postgres`,
      ['pgvectorCeiling'],
    ),
  );
  if (items12 > ceiling) {
    reasons.push(
      reason(
        'past-flat',
        'it is past what a flat scan holds at your latency target, so you want an index',
        ['flatScanUnder10ms', 'flatScanUnder50ms', 'flatScanUnder200ms'],
      ),
    );
  }
  if (w.filtering !== 'never') {
    reasons.push(
      reason(
        'filter-ok',
        'your filtering is light enough that the planner should cope at this size',
      ),
    );
  }
  if (w.postgres) {
    reasons.push(
      reason(
        'already-postgres',
        'you already run Postgres, so pgvector adds no new system to operate',
      ),
    );
  }
  return finish(2, items12, ceiling, reasons, w, a);
}

function finish(
  tier: Tier,
  items12: number,
  ceiling: number,
  reasons: Reason[],
  w: Workload,
  a: Assumptions,
): Decision {
  return {
    tier,
    items12,
    flatCeiling: ceiling,
    reasons,
    whatWouldChange: whatWouldChange(tier, items12, ceiling, w, a),
  };
}

export function whatWouldChange(
  tier: Tier,
  items12: number,
  ceiling: number,
  w: Workload,
  a: Assumptions,
): string {
  if (tier === 3) {
    const softeners: string[] = [];
    if (w.filtering === 'always') softeners.push('drop the always-on metadata filter');
    if (w.tenancy === 'many') softeners.push('give each tenant its own store');
    if (w.matching === 'hybrid') softeners.push('stop needing keyword and semantic together');
    if (w.changeRate === 'constant') softeners.push('move to batched daily updates');
    if (w.residency === 'airgapped' || w.residency === 'edge') {
      softeners.push('relax the deployment constraint');
    }
    if (items12 > a.pgvectorCeiling) {
      softeners.push(`stay under ${compactItems(a.pgvectorCeiling)} items`);
    }
    return softeners.length > 0
      ? `If you ${softeners.slice(0, 2).join(', or ')}, a simpler setup comes back into range.`
      : 'Revisit if the workload simplifies, in filtering, tenancy or deployment.';
  }
  if (tier === 2) {
    return `If you pass ${compactItems(a.pgvectorCeiling)} items, start filtering on every query, or add tenants to the same store, revisit this.`;
  }
  if (tier === 1) {
    return 'If you start needing “find things like this” rather than exact terms, run this again with meaning selected.';
  }
  return `If you pass ${compactItems(ceiling)} items at this latency target, add filtering, or go past ten queries per second, revisit this.`;
}
