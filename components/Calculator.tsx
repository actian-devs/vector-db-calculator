'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { footprint, itemsAfterGrowth } from '@/lib/compute';
import { decide, TIER_COPY } from '@/lib/decision';
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
import { CostTable } from './CostTable';
import { ExportPanel } from './ExportPanel';
import { ScaleGauge } from './ScaleGauge';
import { Segmented } from './Segmented';
import { TelemetryNotice } from './TelemetryNotice';

const TIER_COLOUR: Record<Tier, { c: string; soft: string }> = {
  0: { c: 'var(--teal)', soft: 'var(--teal-soft)' },
  1: { c: 'var(--teal)', soft: 'var(--teal-soft)' },
  2: { c: 'var(--amber)', soft: 'var(--amber-soft)' },
  3: { c: 'var(--blue)', soft: 'var(--blue-soft)' },
};

function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

const STANDARD_DIMS = [384, 768, 1536, 3072];
/** Origin plus path, so the share link is absolute without re-reading location on every render. */
const BASE_URL =
  typeof window === 'undefined' ? '' : window.location.origin + window.location.pathname;

export function Calculator() {
  // The query string is the store. Nothing is duplicated in React, so there is
  // no second copy to keep in step and the back button works for free.
  const search = useSyncExternalStore(subscribeToSearch, getSearch, getServerSearch);

  const { workload, assumptions } = useMemo(() => decodeState(search), [search]);
  const campaign = useMemo(() => readCampaign(search), [search]);
  const shareUrl = useMemo(
    () => (search === '' ? '' : `${BASE_URL}${search}`),
    [search],
  );
  const customDims = !STANDARD_DIMS.includes(workload.dims);

  const commit = useCallback((w: Workload, a: Assumptions) => {
    replaceSearch(mergeIntoLocation(getHref(), w, a));
  }, []);

  const setAssumptions = useCallback(
    (a: Assumptions) => commit(workload, a),
    [commit, workload],
  );

  const decision = useMemo(() => decide(workload, assumptions), [workload, assumptions]);
  const today = useMemo(
    () => footprint(workload.items, workload.dims, assumptions),
    [workload.items, workload.dims, assumptions],
  );
  const next = useMemo(
    () => footprint(itemsAfterGrowth(workload), workload.dims, assumptions),
    [workload, assumptions],
  );

  useEffect(() => {
    recordEvaluation(workload, assumptions, decision, campaign);
  }, [workload, assumptions, decision, campaign]);

  const set = useCallback(
    <K extends keyof Workload>(key: K, value: Workload[K]) =>
      commit({ ...workload, [key]: value }, assumptions),
    [commit, workload, assumptions],
  );

  const copy = TIER_COPY[decision.tier];
  const colour = TIER_COLOUR[decision.tier];
  const tierVars = { '--tc': colour.c, '--tcs': colour.soft } as React.CSSProperties;
  const sliderIndex = Math.max(
    0,
    ITEM_STEPS.findIndex((s) => s >= workload.items),
  );
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
              Describe your agent or RAG workload. The verdict updates as you go, and
              sometimes it is no.
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
                    Items to remember or search
                  </span>
                  <span className="hint">chunks, memories, documents, rows</span>
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
                    <input
                      className="numin mono"
                      type="number"
                      min={2}
                      max={16384}
                      step={1}
                      data-testid="dims-custom-input"
                      value={workload.dims}
                      aria-label="Custom embedding dimensions"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) {
                          set('dims', Math.min(16384, Math.max(2, Math.round(n))));
                        }
                      }}
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
                  hint="decides what pgvector costs you"
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
                  hint="the constraint that overrides everything else"
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
                <span className="vstep">{decision.tier + 1} of 4</span>
              </div>
              <h3 data-testid="verdict">{copy.headline}</h3>
              <p>{copy.lede}</p>
            </div>

            <ScaleGauge
              items={decision.items12}
              tier={decision.tier}
              growth={workload.growth}
            />

            <CostTable today={today} next={next} growth={workload.growth} />

            <div className="card">
              <div className="card-h">WHY YOU LANDED HERE</div>
              <ul className="because" data-testid="reasons">
                {decision.reasons.slice(0, 3).map((r) => (
                  <li key={r.id}>{r.text}</li>
                ))}
              </ul>
              <div className="card-h">WHAT WOULD CHANGE THIS</div>
              <p className="change">{decision.whatWouldChange}</p>
            </div>

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
                      href={withUtm(LINKS.community.href, campaign, 'tier-3')}
                      rel="noopener"
                      data-outbound="true"
                    >
                      Try Community Edition free
                    </a>
                    <p className="fine">
                      Community Edition holds up to 5,000 vectors without a licence, enough to
                      try it against a sample of your data.
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
