import {
  ANY_LATENCY_BUDGET_MS,
  flatCeiling,
  itemsAfterGrowth,
  pgvectorCeiling,
  scanMs,
  throughputBounds,
} from './compute';
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
 *    combination, at scale. "At scale" means past the flat-scan ceiling and
 *    past a share of the pgvector ceiling (stackingGateFraction), so a 40K-row
 *    workload is never sent to a dedicated store for its feature list.
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

/**
 * On edge hardware an embedded store is a fair answer at tier 2 as well. The
 * tier, badge and reading list stay tier 2; only the wording changes.
 */
const EDGE_TIER_2: TierCopy = {
  badge: 'TIER 2',
  headline: 'pgvector or an embedded store will carry you for now',
  lede: 'An HNSW index handles this shape of workload. On edge or on-device hardware an embedded vector store usually fits better than running a database server.',
};

/**
 * On edge hardware the honest tier 3 answer is an embedded store, not a
 * database server, which is what the edge consideration says too.
 */
const EDGE_TIER_3: TierCopy = {
  badge: 'TIER 3',
  headline: 'You need a dedicated, embedded vector store',
  lede: 'This is more than one Postgres instance holds on the memory you set, and on edge or on-device hardware an embedded vector store usually fits better than running a database server.',
};

export function tierCopy(tier: Tier, w: Workload): TierCopy {
  if (w.residency === 'edge' && tier === 2) return EDGE_TIER_2;
  if (w.residency === 'edge' && tier === 3) return EDGE_TIER_3;
  return TIER_COPY[tier];
}

/**
 * A visible line under the verdict for the two deployment choices a reader is
 * most likely to expect to change it. It never does (hard rule 7), so the line
 * says how the verdict reads on that hardware instead.
 */
export function deploymentNote(w: Workload): string | null {
  if (w.residency === 'airgapped') {
    return 'Air-gapped does not change the verdict. Postgres self-hosts with no outbound dependency.';
  }
  if (w.residency === 'edge') {
    return "On edge hardware the limit is the device's memory, so set the memory budget to what it actually has.";
  }
  return null;
}


function reason(id: string, text: string, dependsOn?: (keyof Assumptions)[]): Reason {
  return dependsOn ? { id, text, dependsOn } : { id, text };
}

/** "a", "a and b", "a, b and c". */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four'];

/** How each stackable consideration is named when the verdict lists it. */
const STACK_LABEL: Record<string, string> = {
  hybrid: 'hybrid search',
  'multi-tenant': 'many tenants',
  churn: 'constant churn',
  filtering: 'always-on filtering',
};

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
  // Below the heavy-filtering ceiling filtering is not a demand at all, which
  // is what keeps that assumption live now that it no longer escalates alone.
  if (w.filtering === 'always' && items12 > a.heavyFilterCeiling) {
    out.push({
      id: 'filtering',
      text: `Every query filters by metadata, at ${compactItems(items12)} items.`,
      handledBy:
        'pgvector 0.8 iterative index scans, partial indexes per common filter value, or partitioning by the filter column all help. Past this size a general-purpose planner can still end up choosing between recall and latency, so test with your real filters.',
    });
  }
  if (w.qps === 101) {
    out.push({
      id: 'qps',
      text: 'Peak load is over 100 queries per second.',
      handledBy:
        'Read replicas behind a connection pooler such as PgBouncer spread this across Postgres nodes. Size the replica count from a load test on your own data, not from this page.',
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

/**
 * Only these count toward stacked demands. Air-gapped is never a reason at any
 * scale (hard rule 7). Edge argues for an embedded store, not a dedicated
 * server. Query load is met with replicas, not a different engine.
 */
const STACKABLE: ReadonlySet<string> = new Set(Object.keys(STACK_LABEL));

/** The items a stacked-demands verdict needs before it can fire. */
export function stackingGate(w: Workload, a: Assumptions): number {
  return Math.max(flatCeiling(w, a), a.stackingGateFraction * pgvectorCeiling(w, a));
}

export function decide(w: Workload, a: Assumptions): Decision {
  const items12 = itemsAfterGrowth(w);
  const flat = flatCeiling(w, a);
  const pg = pgvectorCeiling(w, a);
  const considerations = considerationsFor(w, items12, a);
  const reasons: Reason[] = [];
  const { slow, fast } = throughputBounds(a);

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
    return finish(1, items12, flat, pg, reasons, considerations, [], w, a);
  }

  // --- Tier 3: scale first, operational demands only in combination ---

  if (items12 > pg) {
    reasons.push(
      reason(
        'past-pgvector',
        `at ${compactItems(items12)} items and ${w.dims} dimensions the HNSW index ` +
          `(vectors x ${a.hnswMemoryOverhead} for the graph) needs about ${indexGb(items12, w, a)}GB, ` +
          `past the ${a.ramBudgetGb}GB you said is available`,
        ['ramBudgetGb', 'hnswMemoryOverhead'],
      ),
    );
  }

  // Several operational demands at once, on a workload that is already large,
  // is a different proposition from any one of them alone. Someone already
  // running Postgres has a standing reason to stay, so the bar is higher.
  const stackable = considerations.filter((c) => STACKABLE.has(c.id));
  const bar = w.postgres ? 3 : 2;
  const stacked =
    stackable.length >= bar && items12 > stackingGate(w, a) ? stackable.map((c) => c.id) : [];
  if (stacked.length > 0) {
    reasons.push(
      reason(
        'stacked-demands',
        `${listOf(stacked.map((id) => STACK_LABEL[id]))} stack on this workload at ` +
          `${compactItems(items12)} items, ` +
          (w.postgres
            ? 'which is enough to outweigh staying on the Postgres you already run'
            : 'and you would be standing up a new system either way'),
        stacked.includes('filtering')
          ? ['stackingGateFraction', 'heavyFilterCeiling']
          : ['stackingGateFraction'],
      ),
    );
  }

  if (reasons.length > 0) {
    return finish(3, items12, flat, pg, reasons, considerations, stacked, w, a);
  }

  // --- Tier 0: a flat scan genuinely holds ---

  const quiet = w.qps <= 10;
  if (items12 <= flat && quiet && w.filtering === 'never' && w.tenancy === 'single') {
    const optimistic = scanMs(items12, w.dims, fast);
    const pessimistic = scanMs(items12, w.dims, slow);
    const target = w.latencyMs === 0 ? ANY_LATENCY_BUDGET_MS : w.latencyMs;
    reasons.push(
      reason(
        'fits-flat',
        `scanning ${compactItems(items12)} vectors of ${w.dims} dimensions takes about ` +
          `${optimistic < 1 ? optimistic.toFixed(2) : Math.round(optimistic)}ms` +
          (w.latencyMs === 0 ? ', inside a second' : `, inside your ${w.latencyMs}ms target`),
        ['gflopsHigh'],
      ),
    );
    if (w.matching === 'hybrid') {
      reasons.push(
        reason(
          'hybrid-keyword',
          'you also match exact terms, so pair the scan with SQLite FTS5 or Postgres full-text for the keyword half',
        ),
      );
    }
    reasons.push(
      reason(
        'nothing-to-index',
        'no metadata filtering and a single workspace, so there is nothing to index around',
      ),
    );
    if (pessimistic > target) {
      reasons.push(
        reason(
          'marginal-hardware',
          `on slower hardware the same scan could take ${durationLabel(pessimistic)}, so measure before relying on it`,
          ['gflopsLow'],
        ),
      );
    }
    return finish(0, items12, flat, pg, reasons, considerations, [], w, a);
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
        `a brute-force scan would take about ${Math.round(scanMs(items12, w.dims, fast))}ms here, so you want an index`,
        ['gflopsHigh'],
      ),
    );
  } else {
    // Small enough to scan, so say what kept it off a flat file.
    const blockers: string[] = [];
    if (!quiet) blockers.push(w.qps === 101 ? 'over 100 queries per second' : '10 to 100 queries per second');
    if (w.filtering === 'always') blockers.push('a metadata filter on every query');
    if (w.filtering === 'sometimes') blockers.push('metadata filtering');
    if (w.tenancy === 'many') blockers.push('many tenants sharing the store');
    reasons.push(
      reason(
        'needs-index',
        `a flat scan would be fast enough, but ${listOf(blockers)} ${blockers.length > 1 ? 'are' : 'is'} easier to serve from an indexed table than from a file`,
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
  return finish(2, items12, flat, pg, reasons, considerations, [], w, a);
}

/** Decimal GB for the HNSW index alone: vectors times the graph overhead, no headroom. */
function indexGb(items: number, w: Workload, a: Assumptions): number {
  return Math.round((items * w.dims * a.bytesPerComponentF32 * a.hnswMemoryOverhead) / 1e9);
}

function durationLabel(ms: number): string {
  if (ms >= 120_000) return `${Math.round(ms / 60_000)} minutes`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`;
  return `${Math.round(ms)}ms`;
}

function finish(
  tier: Tier,
  items12: number,
  flat: number,
  pg: number,
  reasons: Reason[],
  considerations: Consideration[],
  stacked: string[],
  w: Workload,
  a: Assumptions,
): Decision {
  return {
    tier,
    copy: tierCopy(tier, w),
    deploymentNote: deploymentNote(w),
    items12,
    flatCeiling: flat,
    pgvectorCeiling: pg,
    reasons,
    considerations,
    stacked,
    whatWouldChange: whatWouldChange(tier, items12, flat, pg, reasons, stacked, w, a),
  };
}

export function whatWouldChange(
  tier: Tier,
  items12: number,
  flat: number,
  pg: number,
  reasons: Reason[],
  stacked: string[],
  w: Workload,
  a: Assumptions,
): string {
  const bar = w.postgres ? 3 : 2;
  const gate = stackingGate(w, a);
  const stackNames = listOf(Object.values(STACK_LABEL));

  if (tier === 3) {
    // One clause per reason. Each reason forces tier 3 on its own, so every
    // clause has to be met, and the sentence says so.
    const clauses: string[] = [];
    if (reasons.some((r) => r.id === 'past-pgvector')) {
      clauses.push(
        `give the index about ${indexGb(items12, w, a)}GB of memory (you set ${a.ramBudgetGb}GB), ` +
          `or stay under ${compactItems(pg)} items at ${w.dims} dimensions`,
      );
    }
    if (stacked.length > 0) {
      const names = listOf(stacked.map((id) => STACK_LABEL[id]));
      clauses.push(
        `bring ${names} down to at most ${NUMBER_WORDS[bar - 1]} on this store, ` +
          `or stay under ${compactItems(gate)} items`,
      );
    }
    if (clauses.length === 1) return `If you ${clauses[0]}, Postgres comes back into range.`;
    return `Postgres comes back into range only if you ${clauses.join(', and also ')}.`;
  }
  if (tier === 2) {
    return (
      `If you pass ${compactItems(pg)} items at ${w.dims} dimensions, or ${NUMBER_WORDS[bar]} or more of ` +
      `${stackNames} land on one store past ${compactItems(gate)} items, revisit this.`
    );
  }
  if (tier === 1) {
    return 'If you start needing “find things like this” rather than exact terms, run this again with meaning selected.';
  }
  return `If you pass ${compactItems(flat)} items at ${w.dims} dimensions, add filtering, or go past ten queries per second, revisit this.`;
}
