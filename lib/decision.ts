import { flatCeiling, itemsAfterGrowth, pgvectorCeiling, scanMs } from './compute';
import { compactItems } from './format';
import type {
  Assumptions,
  Consideration,
  Decision,
  Reason,
  Tier,
  TierCopy,
  Workload,
} from './types';

/**
 * The decision model.
 *
 * Pure and framework-free. Given a workload and a set of assumptions it returns
 * one tier, the reasons behind it, and the things to watch that did not change
 * the verdict.
 *
 * Two rules this model is built around, both the result of review feedback:
 *
 * 1. No capability alone forces a dedicated store. Postgres with pgvector does
 *    hybrid search, multi-tenancy, air-gapped deployment and frequent updates.
 *    Treating any of those as an automatic escalation is vendor bias, not
 *    engineering, and a reader who has run those setups will say so. They
 *    surface as considerations instead, and only tip the verdict in
 *    combination, at scale.
 *
 * 2. Ceilings are derived, never asserted. The flat-scan ceiling comes from the
 *    same scan arithmetic the page displays, so the recommendation cannot
 *    contradict the number next to it. The pgvector ceiling comes from whether
 *    the HNSW index fits in memory.
 *
 * Editorial constraint, see AGENTS.md: tiers 0 and 1 are real outcomes. Do not
 * tune thresholds so that more workloads land on tier 3.
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
    lede: 'This is where a dedicated store earns its place, because of the combination of scale and operational demands on this workload.',
  },
};

function reason(id: string, text: string, dependsOn?: (keyof Assumptions)[]): Reason {
  return dependsOn ? { id, text, dependsOn } : { id, text };
}

/**
 * Operational demands that are real work but that Postgres can meet.
 *
 * Each names how it is normally solved there, so a reader can check our
 * reasoning rather than take the verdict on faith. They escalate only when
 * several stack up on a workload that is already large.
 */
function considerationsFor(w: Workload, items12: number, a: Assumptions): Consideration[] {
  const out: Consideration[] = [];

  if (w.matching === 'hybrid') {
    out.push({
      id: 'hybrid',
      text: 'You need keyword and semantic search together.',
      handledBy:
        'Postgres does this natively with tsvector full-text alongside pgvector, combined with reciprocal rank fusion. A dedicated store earns its place here only if the fusion and ranking become the hard part.',
    });
  }
  if (w.tenancy === 'many') {
    out.push({
      id: 'multi-tenant',
      text: 'Many tenants share one store.',
      handledBy:
        'Row-level security, a tenant column with a partial index, or partitioning covers this on Postgres, and plenty of teams run it that way. It gets harder when per-tenant filtering meets a large index.',
    });
  }
  if (w.changeRate === 'constant') {
    out.push({
      id: 'churn',
      text: 'The data changes constantly, with updates and deletes.',
      handledBy:
        'HNSW on pgvector accepts updates. Watch index bloat and vacuum behavior under sustained churn rather than assuming it will not work.',
    });
  }
  if (w.residency === 'airgapped') {
    out.push({
      id: 'airgapped',
      text: 'The data has to stay inside an air-gapped network.',
      handledBy:
        'This is not an argument for any particular database. Postgres self-hosts cleanly with no outbound dependency, so judge this on scale and operations, not on the network boundary.',
    });
  }
  if (w.residency === 'edge') {
    out.push({
      id: 'edge',
      text: 'This runs on edge or on-device hardware.',
      handledBy:
        'The constraint here is the memory budget above, not the engine. On constrained hardware an embedded store is usually a better fit than a Postgres instance, so set the memory figure to what the device actually has.',
    });
  }
  if (w.filtering === 'always' && items12 > a.heavyFilterCeiling) {
    out.push({
      id: 'filtering',
      text: `Every query filters by metadata, at ${compactItems(items12)} items.`,
      handledBy:
        'This is where a general-purpose planner struggles most. It can abandon the index and exact-sort the survivors, which keeps recall and spends latency, or keep the index and lose recall.',
    });
  }
  return out;
}

/**
 * Tiers 0, 2 and 3 get the same memory cost estimate, shown the same way, so it
 * never tilts toward the paid tier. Tier 1 is a full-text index, which is small
 * and not sized by this model.
 */
export function hasMemoryEstimate(tier: Tier): boolean {
  return tier !== 1;
}

/** Considerations that are shown but never counted toward stacked demands. */
const NOT_STACKABLE: ReadonlySet<string> = new Set(['airgapped', 'edge', 'filtering']);

export function decide(w: Workload, a: Assumptions): Decision {
  const items12 = itemsAfterGrowth(w);
  const flat = flatCeiling(w, a);
  const pg = pgvectorCeiling(w, a);
  const considerations = considerationsFor(w, items12, a);
  const reasons: Reason[] = [];

  // Exact-term matching is answered by a keyword index whatever the scale.
  if (w.matching === 'exact') {
    reasons.push(
      reason(
        'exact-matching',
        'you match exact terms rather than meaning, which is what a keyword index is for',
      ),
    );
    if (items12 > pg) {
      reasons.push(
        reason('fts-scales', `full-text indexes stay fast at ${compactItems(items12)} items`),
      );
    }
    return finish(1, items12, flat, pg, reasons, considerations, w, a);
  }

  // --- Tier 3: scale first, operational demands only in combination ---

  if (items12 > pg) {
    reasons.push(
      reason(
        'past-pgvector',
        `at ${compactItems(items12)} items and ${w.dims} dimensions the HNSW index needs about ` +
          `${Math.round((items12 * w.dims * a.bytesPerComponentF32 * a.hnswMemoryOverhead) / 1e9)}GB, ` +
          `past the ${a.ramBudgetGb}GB you said is available`,
        ['ramBudgetGb', 'hnswMemoryOverhead'],
      ),
    );
  }

  if (w.filtering === 'always' && items12 > a.heavyFilterCeiling) {
    reasons.push(
      reason(
        'heavy-filter',
        `every query filters by metadata at ${compactItems(items12)} items, which is where a general-purpose planner starts trading recall against latency`,
        ['heavyFilterCeiling'],
      ),
    );
  }

  // Several operational demands at once, on a workload already past a flat scan,
  // is a different proposition from any one of them alone. Someone already
  // running Postgres has a standing reason to stay, so the bar is higher.
  // Only hybrid, multi-tenancy, churn and heavy filtering count. Air-gapped is
  // never a reason at any scale (hard rule 7). Edge argues for an embedded
  // store, not a dedicated server, so it cannot push toward one. Filtering
  // already escalates on its own above, so it is not counted twice.
  const stacked = considerations.filter((c) => !NOT_STACKABLE.has(c.id));
  const bar = w.postgres ? 3 : 2;
  if (stacked.length >= bar && items12 > flat) {
    reasons.push(
      reason(
        'stacked-demands',
        `${stacked.length} operational demands stack on this workload at ${compactItems(items12)} items, ` +
          (w.postgres
            ? 'which is enough to outweigh staying on the Postgres you already run'
            : 'and you would be standing up a new system either way'),
      ),
    );
  }

  if (reasons.length > 0) {
    return finish(3, items12, flat, pg, reasons, considerations, w, a);
  }

  // --- Tier 0: a flat scan genuinely holds ---

  const quiet = w.qps <= 10;
  if (items12 <= flat && quiet && w.filtering === 'never' && w.tenancy === 'single') {
    const optimistic = scanMs(items12, w.dims, a.gflopsHigh);
    const pessimistic = scanMs(items12, w.dims, a.gflopsLow);
    reasons.push(
      reason(
        'fits-flat',
        `scanning ${compactItems(items12)} vectors of ${w.dims} dimensions takes about ` +
          `${optimistic < 1 ? optimistic.toFixed(2) : Math.round(optimistic)}ms` +
          (w.latencyMs === 0 ? '' : `, inside your ${w.latencyMs}ms target`),
        ['gflopsHigh'],
      ),
    );
    reasons.push(
      reason(
        'nothing-to-index',
        'no metadata filtering and a single workspace, so there is nothing to index around',
      ),
    );
    if (w.latencyMs !== 0 && pessimistic > w.latencyMs) {
      reasons.push(
        reason(
          'marginal-hardware',
          `on slower hardware the same scan could take ${Math.round(pessimistic)}ms, so measure before relying on it`,
          ['gflopsLow'],
        ),
      );
    }
    return finish(0, items12, flat, pg, reasons, considerations, w, a);
  }

  // --- Tier 2: an index on Postgres ---

  reasons.push(
    reason(
      'within-hnsw',
      `${compactItems(items12)} items at ${w.dims} dimensions indexes inside your ${a.ramBudgetGb}GB budget`,
      ['ramBudgetGb', 'hnswMemoryOverhead'],
    ),
  );
  if (items12 > flat) {
    reasons.push(
      reason(
        'past-flat',
        `a brute-force scan would take about ${Math.round(scanMs(items12, w.dims, a.gflopsHigh))}ms here, so you want an index`,
        ['gflopsHigh'],
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
  return finish(2, items12, flat, pg, reasons, considerations, w, a);
}

function finish(
  tier: Tier,
  items12: number,
  flat: number,
  pg: number,
  reasons: Reason[],
  considerations: Consideration[],
  w: Workload,
  a: Assumptions,
): Decision {
  return {
    tier,
    items12,
    flatCeiling: flat,
    pgvectorCeiling: pg,
    reasons,
    considerations,
    whatWouldChange: whatWouldChange(tier, items12, flat, pg, w, a),
  };
}

export function whatWouldChange(
  tier: Tier,
  items12: number,
  flat: number,
  pg: number,
  w: Workload,
  a: Assumptions,
): string {
  if (tier === 3) {
    const options: string[] = [];
    if (items12 > pg) {
      options.push(
        `give the index more than ${a.ramBudgetGb}GB, or cut dimensions, which is the cheapest lever here`,
      );
    }
    if (w.filtering === 'always') options.push('drop the always-on metadata filter');
    if (items12 > pg) options.push(`stay under ${compactItems(pg)} items at these dimensions`);
    options.push('reduce the number of operational demands landing on one store');
    return `If you ${options.slice(0, 2).join(', or ')}, Postgres comes back into range.`;
  }
  if (tier === 2) {
    return `If you pass ${compactItems(pg)} items at ${w.dims} dimensions, or stack more operational demands onto the same store, revisit this.`;
  }
  if (tier === 1) {
    return 'If you start needing “find things like this” rather than exact terms, run this again with meaning selected.';
  }
  return `If you pass ${compactItems(flat)} items at ${w.dims} dimensions, add filtering, or go past ten queries per second, revisit this.`;
}
