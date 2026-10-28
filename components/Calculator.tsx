'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  isGaConfigured,
  RESULT_SETTLE_MS,
  trackCalculatorStarted,
  trackOutboundCta,
  trackRecommendation,
} from '@/lib/analytics';
import { footprint, itemsAfterGrowth, memoryCost } from '@/lib/compute';
import { decide, hasMemoryEstimate, listOf } from '@/lib/decision';
import { fullItems } from '@/lib/format';
import { readCampaign, readsFor, withUtm, LINKS } from '@/lib/links';
import { recordEvaluation } from '@/lib/telemetry';
import type { Assumptions, Tier, Workload } from '@/lib/types';
import { ITEM_STEPS, decodeState, mergeIntoLocation } from '@/lib/urlState';
import {
  getHref,
  getSearch,
  getServerSearch,
  replaceSearch,
  subscribeToSearch,
} from '@/lib/urlStore';
import { AssumptionsPanel } from './AssumptionsPanel';
import { CostChart } from './CostChart';
import { CostTable } from './CostTable';
import { ExportPanel } from './ExportPanel';
import { InfraCostCard } from './InfraCostCard';
import { NumberField } from './NumberField';
import { ScaleGauge } from './ScaleGauge';
import { Segmented } from './Segmented';
import { TelemetryNotice } from './TelemetryNotice';
import { useHydrated } from './useHydrated';

const TIER_COLOUR: Record<Tier, { c: string; soft: string }> = {
  0: { c: 'var(--teal)', soft: 'var(--teal-soft)' },
  1: { c: 'var(--teal)', soft: 'var(--teal-soft)' },
  2: { c: 'var(--amber)', soft: 'var(--amber-soft)' },
  3: { c: 'var(--blue-deep)', soft: 'var(--blue-soft)' },
};

function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

const STANDARD_DIMS = [384, 768, 1536, 3072];

export function Calculator() {
  // The query string is the store. Nothing is duplicated in React, so there is
  // no second copy to keep in step. Edits replace the history entry rather than
  // adding one, so the back button leaves the page instead of undoing a click.
  const search = useSyncExternalStore(subscribeToSearch, getSearch, getServerSearch);

  const { workload, assumptions } = useMemo(() => decodeState(search), [search]);
  const campaign = useMemo(() => readCampaign(search), [search]);
  // Built from the decoded state rather than the raw query string, so a fresh
  // visit with nothing in the address bar still copies a link that reproduces
  // the verdict. Anything else in the URL, such as utm_campaign, is kept.
  const shareUrl = useMemo(
    () =>
      typeof window === 'undefined' ? '' : mergeIntoLocation(getHref(), workload, assumptions),
    // search is the store; the href it came from changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, workload, assumptions],
  );
  const customDims = !STANDARD_DIMS.includes(workload.dims);

  const decision = useMemo(() => decide(workload, assumptions), [workload, assumptions]);

  const commit = useCallback(
    (w: Workload, a: Assumptions) => {
      trackCalculatorStarted(decision.tier);
      replaceSearch(mergeIntoLocation(getHref(), w, a));
    },
    [decision.tier],
  );

  const setAssumptions = useCallback(
    (a: Assumptions) => commit(workload, a),
    [commit, workload],
  );
  const today = useMemo(
    () => footprint(workload.items, workload.dims, assumptions),
    [workload.items, workload.dims, assumptions],
  );
  const next = useMemo(
    () => footprint(itemsAfterGrowth(workload), workload.dims, assumptions),
    [workload, assumptions],
  );
  // Same estimate for tiers 0, 2 and 3; none for tier 1, a small full-text index.
  const priced = hasMemoryEstimate(decision.tier);
  const costToday = useMemo(
    () => (priced ? memoryCost(workload.items, workload.dims, assumptions) : null),
    [priced, workload.items, workload.dims, assumptions],
  );
  const costNext = useMemo(
    () => (priced ? memoryCost(decision.items12, workload.dims, assumptions) : null),
    [priced, decision.items12, workload.dims, assumptions],
  );

  // First-party telemetry and GA4 share this update. The beacon keeps its own
  // payload and stays off without an endpoint. GA4, once a measurement ID is
  // set, records only the tier, from the effect below.
  useEffect(() => {
    recordEvaluation(workload, assumptions, decision, campaign);
  }, [workload, assumptions, decision, campaign]);

  const set = useCallback(
    <K extends keyof Workload>(key: K, value: Workload[K]) =>
      commit({ ...workload, [key]: value }, assumptions),
    [commit, workload, assumptions],
  );

  const hydrated = useHydrated();

  useEffect(() => {
    if (!hydrated || !isGaConfigured()) return;
    const timer = window.setTimeout(() => trackRecommendation(decision.tier), RESULT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [hydrated, decision.tier]);

  useEffect(() => {
    if (!isGaConfigured()) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[data-outbound="true"]');
      if (!(anchor instanceof HTMLAnchorElement) || !anchor.href) return;
      trackOutboundCta(anchor.href, decision.tier);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [decision.tier]);
  // Neutral until the browser has read the link, so crawlers and the first
  // paint never show a verdict the link does not hold.
  const copy = hydrated
    ? decision.copy
    : {
        badge: 'VERDICT',
        headline: 'Describe your workload to see the verdict',
        lede: 'The verdict updates as you change any input.',
      };
  const stackedText = listOf(
    decision.considerations
      .filter((c) => decision.stacked.includes(c.id))
      .map((c) => c.text.replace(/\.$/, '').toLowerCase()),
  );
  const colour = hydrated
    ? TIER_COLOUR[decision.tier]
    : { c: 'var(--ink-2)', soft: 'var(--panel)' };
  const tierVars = { '--tc': colour.c, '--tcs': colour.soft } as React.CSSProperties;
  // A custom count above the top stop sits at the top, not back at 1K.
  const stopAtOrAbove = ITEM_STEPS.findIndex((s) => s >= workload.items);
  const sliderIndex = stopAtOrAbove === -1 ? ITEM_STEPS.length - 1 : stopAtOrAbove;
  const reads = readsFor(decision.tier, workload);

  return (
    <>
      <div className="minibar" style={tierVars}>
        <a href="#verdict">
          <span className="badge">{copy.badge}</span>
          <b>{copy.headline}</b>
          <span className="go">see why</span>
        </a>
      </div>

      <div className="split">
        <section className="controls" id="controls">
          <div className="intro">
            <h1>Do you need a vector database?</h1>
            <p>
              Describe your agent or RAG workload. The verdict updates as you go.
            </p>
          </div>

          <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
            <details className="grp" open>
              <summary>
                <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <ellipse cx="12" cy="6" rx="8" ry="3" />
                  <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
                  <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
                </svg>
                <span className="ttl">WORKLOAD SIZE</span>
                <Chevron />
              </summary>
              <div className="fields">
                <div className="f full">
                  <span className="lab" id="items-lab">
                    Vectors to store
                  </span>
                  <span className="hint">one per chunk, memory or row</span>
                  <div className="sl-val">
                    <b className="mono" data-testid="items-today">
                      {fullItems(workload.items)}
                    </b>
                    <span>today</span>
                  </div>
                  <input
                    type="range"
                    id="items"
                    min={0}
                    max={ITEM_STEPS.length - 1}
                    step={1}
                    value={sliderIndex}
                    aria-labelledby="items-lab"
                    onChange={(e) => set('items', ITEM_STEPS[Number(e.target.value)])}
                  />
                  <div className="sl-ticks" aria-hidden="true">
                    <span>1K</span><span>10K</span><span>100K</span>
                    <span>1M</span><span>10M</span><span>100M</span>
                  </div>
                </div>

                <Segmented
                  name="growth"
                  legend="Growth in 12 months"
                  hint="multiplier on the item count"
                  value={workload.growth}
                  onChange={(v) => set('growth', v)}
                  options={[
                    { value: 1, label: 'flat' },
                    { value: 2, label: '2x' },
                    { value: 10, label: '10x' },
                    { value: 100, label: '100x' },
                  ]}
                />

                <div className="f">
                  <span className="lab" id="dims-lab">
                    Embedding dimensions
                  </span>
                  <span className="hint">text-embedding-3-small 1536 / MiniLM-L6 384</span>
                  <div className="seg" role="radiogroup" aria-labelledby="dims-lab">
                    {[384, 768, 1536, 3072].map((d) => (
                      <span key={d} style={{ display: 'contents' }}>
                        <input
                          type="radio"
                          id={`dims-${d}`}
                          name="dims"
                          data-field="dims"
                          checked={!customDims && workload.dims === d}
                          onChange={() => set('dims', d)}
                        />
                        <label htmlFor={`dims-${d}`}>{d}</label>
                      </span>
                    ))}
                    <span style={{ display: 'contents' }}>
                      <input
                        type="radio"
                        id="dims-custom"
                        name="dims"
                        data-field="dims"
                        checked={customDims}
                        onChange={() => set('dims', 2048)}
                      />
                      <label htmlFor="dims-custom">custom</label>
                    </span>
                  </div>
                  {customDims ? (
                    <NumberField
                      className="numin mono"
                      min={2}
                      max={16384}
                      step={1}
                      data-testid="dims-custom-input"
                      value={workload.dims}
                      aria-label="Custom embedding dimensions"
                      onCommit={(n) => set('dims', Math.min(16384, Math.max(2, Math.round(n))))}
                    />
                  ) : null}
                </div>
              </div>
            </details>

            <details className="grp" open>
              <summary>
                <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3.5 2" />
                </svg>
                <span className="ttl">PERFORMANCE TARGET</span>
                <Chevron />
              </summary>
              <div className="fields">
                <Segmented
                  name="lat"
                  legend="Latency per query"
                  hint="at the retrieval step"
                  value={workload.latencyMs}
                  onChange={(v) => set('latencyMs', v)}
                  options={[
                    { value: 10, label: '<10ms' },
                    { value: 50, label: '<50ms' },
                    { value: 200, label: '<200ms' },
                    { value: 0, label: 'any' },
                  ]}
                />
                <Segmented
                  name="qps"
                  legend="Queries per second at peak"
                  hint="concurrent retrieval load"
                  value={workload.qps}
                  onChange={(v) => set('qps', v)}
                  options={[
                    { value: 1, label: '<1' },
                    { value: 10, label: '1-10' },
                    { value: 100, label: '10-100' },
                    { value: 101, label: '100+' },
                  ]}
                />
              </div>
            </details>

            <details className="grp" open>
              <summary>
                <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M16.5 16.5L21 21" />
                </svg>
                <span className="ttl">QUERY SHAPE</span>
                <Chevron />
              </summary>
              <div className="fields">
                <Segmented
                  name="match"
                  legend="Matching you need"
                  hint="exact terms are IDs, names, code symbols"
                  value={workload.matching}
                  onChange={(v) => set('matching', v)}
                  options={[
                    { value: 'semantic', label: 'meaning' },
                    { value: 'exact', label: 'exact' },
                    { value: 'hybrid', label: 'both' },
                  ]}
                />
                <Segmented
                  name="filter"
                  legend="Metadata filtering"
                  hint="by user, tenant, date, permissions"
                  value={workload.filtering}
                  onChange={(v) => set('filtering', v)}
                  options={[
                    { value: 'never', label: 'never' },
                    { value: 'sometimes', label: 'sometimes' },
                    { value: 'always', label: 'always' },
                  ]}
                />
              </div>
            </details>

            <details className="grp" open>
              <summary>
                <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M3 7l9-4 9 4-9 4-9-4z" />
                  <path d="M3 12l9 4 9-4" />
                  <path d="M3 17l9 4 9-4" />
                </svg>
                <span className="ttl">OPERATIONS</span>
                <Chevron />
              </summary>
              <div className="fields">
                <Segmented
                  name="change"
                  legend="How often data changes"
                  hint="writes after the initial load"
                  value={workload.changeRate}
                  onChange={(v) => set('changeRate', v)}
                  options={[
                    { value: 'append', label: 'append' },
                    { value: 'daily', label: 'daily' },
                    { value: 'constant', label: 'constant' },
                  ]}
                />
                <Segmented
                  name="tenancy"
                  legend="Tenancy"
                  hint="who shares the store"
                  value={workload.tenancy}
                  onChange={(v) => set('tenancy', v)}
                  options={[
                    { value: 'single', label: 'one workspace' },
                    { value: 'many', label: 'many tenants' },
                  ]}
                />
                <Segmented
                  name="pg"
                  legend="Already running Postgres"
                  hint="raises the bar for adding a second system"
                  value={workload.postgres}
                  onChange={(v) => set('postgres', v)}
                  options={[
                    { value: true, label: 'yes' },
                    { value: false, label: 'no' },
                  ]}
                />
              </div>
            </details>

            <details className="grp" open>
              <summary>
                <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18" />
                  <path d="M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
                </svg>
                <span className="ttl">DEPLOYMENT</span>
                <Chevron />
              </summary>
              <div className="fields">
                <Segmented
                  full
                  name="res"
                  legend="Where the data must live"
                  hint="does not change the tier, since Postgres self-hosts anywhere; at tier 3 it shapes the reading list"
                  value={workload.residency}
                  onChange={(v) => set('residency', v)}
                  options={[
                    { value: 'cloud', label: 'any cloud' },
                    { value: 'onprem', label: 'own servers' },
                    { value: 'airgapped', label: 'air-gapped' },
                    { value: 'edge', label: 'edge' },
                  ]}
                />
              </div>
            </details>
          </form>
        </section>

        <aside className="insights" style={tierVars}>
          <div className="ipanel" aria-live="polite">
            <h2>Your verdict</h2>
            <p className="sub">updates as you change anything</p>

            <div className="card vcard" id="verdict">
              <div className="vtop">
                <span className="badge" data-testid="tier-badge">
                  {copy.badge}
                </span>
                {hydrated ? <span className="vstep">{decision.tier + 1} of 4</span> : null}
              </div>
              <h3 data-testid="verdict">{copy.headline}</h3>
              <p>{copy.lede}</p>
              {hydrated && decision.deploymentNote ? (
                <p className="dnote" data-testid="deployment-note">
                  {decision.deploymentNote}
                </p>
              ) : null}
            </div>

            <ScaleGauge
              items={decision.items12}
              tier={decision.tier}
              growth={workload.growth}
              flatCeiling={decision.flatCeiling}
              pgvectorCeiling={decision.pgvectorCeiling}
            />

            <CostTable today={today} next={next} growth={workload.growth} />

            <InfraCostCard today={costToday} next={costNext} assumptions={assumptions} />

            {priced ? (
              <CostChart
                dims={workload.dims}
                assumptions={assumptions}
                items12={decision.items12}
                flatCeiling={decision.flatCeiling}
                pgvectorCeiling={decision.pgvectorCeiling}
              />
            ) : null}

            <div className="card">
              <div className="card-h">WHY YOU LANDED HERE</div>
              <ul className="because" data-testid="reasons">
                {decision.reasons.map((r) => (
                  <li key={r.id}>{r.text}</li>
                ))}
              </ul>
              <div className="card-h">WHAT WOULD CHANGE THIS</div>
              <p className="change">{decision.whatWouldChange}</p>
            </div>

            {decision.considerations.length > 0 ? (
              /**
               * The demands that did NOT decide the verdict, and how Postgres
               * meets each one. Hybrid search and multi-tenancy are the two a
               * reader is most likely to have been told require a dedicated
               * store, so saying nothing about them reads as an omission even
               * when the model handles them correctly.
               */
              <details className="card acard ccard">
                <summary>
                  <span className="card-h" style={{ margin: 0 }}>
                    THINGS TO DESIGN FOR
                  </span>
                  <span className="c-count">{decision.considerations.length}</span>
                  <svg
                    className="chev"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </summary>

                <p className="c-intro">
                  {decision.stacked.length > 0
                    ? `Postgres can meet each of these on its own. What tipped the verdict is ${decision.stacked.length} of them landing on one store at this size: ${stackedText}. The rest did not count toward it.`
                    : 'These did not decide the verdict. Postgres can meet them, and it is worth knowing how before you reach for another system.'}
                </p>
                <ul className="considerations" data-testid="considerations">
                  {decision.considerations.map((c) => (
                    <li key={c.id}>
                      <b>{c.text}</b>
                      <span>{c.handledBy}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <AssumptionsPanel assumptions={assumptions} onChange={setAssumptions} />

            <TelemetryNotice />

            <div className="card">
              <div className="card-h">WORTH READING NEXT</div>
              <ul className="reads">
                {reads.map((l) => (
                  <li key={l.href}>
                    <a
                      href={withUtm(l.href, campaign, `tier-${decision.tier}`)}
                      rel="noopener"
                      data-outbound="true"
                    >
                      {l.title}
                    </a>
                  </li>
                ))}
              </ul>

              <div className="acts">
                {decision.tier === 3 ? (
                  <>
                    <a
                      className="btn btn-primary"
                      href={withUtm(LINKS.product.href, campaign, 'tier-3')}
                      rel="noopener"
                      data-outbound="true"
                    >
                      See what VectorAI DB does
                    </a>
                    <a
                      className="btn btn-ghost"
                      href={withUtm(LINKS.demo.href, campaign, 'tier-3')}
                      rel="noopener"
                      data-outbound="true"
                    >
                      Book a demo
                    </a>
                    <a
                      className="btn btn-ghost"
                      href={withUtm(LINKS.trial.href, campaign, 'tier-3')}
                      rel="noopener"
                      data-outbound="true"
                    >
                      Start a 30-day free trial
                    </a>
                    <p className="fine">
                      Signing up for Community Edition starts a 30-day full-featured trial. For
                      an evaluation at production scale, book a demo.
                    </p>
                  </>
                ) : (
                  <>
                    <a
                      className="btn btn-ghost"
                      href={withUtm(LINKS.memArch.href, campaign, `tier-${decision.tier}`)}
                      rel="noopener"
                      data-outbound="true"
                    >
                      Read the agent memory architecture guide
                    </a>
                    <p className="fine">
                      Bookmark this and run it again when your numbers move.
                    </p>
                  </>
                )}
              </div>
            </div>

            <ExportPanel
              workload={workload}
              assumptions={assumptions}
              decision={decision}
              shareUrl={shareUrl}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
