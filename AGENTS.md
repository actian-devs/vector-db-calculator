# AGENTS.md

Context for AI coding agents working in this repository. Read this before changing anything.

## What this is

"Do you need a vector database?", a sizing tool built for Actian VectorAI DB. It takes a
description of an agent or RAG workload and returns one of four recommendations, from a flat
file up to a dedicated vector database.

People use it to make real infrastructure decisions, so the output has to be defensible
rather than persuasive. A verdict that tells a reader they do not need a vector database is a
correct and expected outcome.

## Stack

Next.js 16 with the App Router, React 19, TypeScript in strict mode. The build is a **static
export** (`output: 'export'`), so it produces plain files with no server and deploys to
GitHub Pages, any CDN, or an air-gapped host.

```
npm run dev        local dev server
npm run verify     typecheck, unit tests and build, the thing to run before pushing
npm run test       unit tests (Vitest)
npm run test:e2e   end-to-end tests (Playwright, runs against the built export)
npm run lint
```

### Architecture

`lib/` holds the decision model and is framework-free on purpose. It imports nothing from
React or the DOM, so it can be unit tested directly, reviewed on its own terms, and reused
outside this app. Keep it that way: no React imports in `lib/`, and no business rules in
components.

| Module | Responsibility |
|---|---|
| `lib/types.ts` | Domain types. No logic. |
| `lib/assumptions.ts` | Default estimates, their metadata, clamping. |
| `lib/compute.ts` | Footprint arithmetic and the log scale. |
| `lib/decision.ts` | The tier model. The valuable part of the repo. |
| `lib/format.ts` | Number and unit formatting. |
| `lib/links.ts` | Every outbound URL, reading lists, UTM tagging. |
| `lib/prices.ts` | Memory list prices from `data/memory-prices.json`, GiB to GB conversion, staleness. |
| `lib/urlState.ts` | Encode and decode the whole state to the query string. |
| `lib/exportRecord.ts` | Markdown and JSON decision records. |
| `lib/telemetry.ts` | First-party anonymous telemetry. Read its header before touching it. |

Components are presentational. `components/Calculator.tsx` owns state and wires the model to
the UI. There is one derivation path: state changes, `decide()` runs, everything re-renders
from its result. Do not add a second source of truth.

## Hard rules

These are editorial positions, not style preferences. Do not relax them, and do not work
around them to "improve conversion".

1. **No benchmark figures: the page sizes workloads, it does not compare products.** No
   performance charts, performance table, or latency or recall figure for any database. The
   page reaches tier 3 from the shape of the workload, then links to the product pages. The
   one chart allowed is the memory cost chart: hardware list prices only, no Actian or
   competitor prices, no vendor names on it.
2. **No competitor performance claims.** Comparison posts are linked. No numbers from them
   are restated here.
3. **Tiers 0 and 1 are real outcomes and keep equal visual weight to tier 3.** Do not make
   tier 3 louder, do not soften tier 0, and do not tune thresholds so more workloads land on
   the paid tier. A reader told they do not need the product is the entire reason this page is
   credible. `lib/__tests__/decision.test.ts` asserts the lower tiers stay reachable; if those
   fail after a threshold change, the guardrail is working.
4. **The arithmetic stays exact and the estimates stay labelled.** Memory and comparison
   counts are exact. Tier break points are estimates, labelled as a rough guide in the UI, and
   editable by the user. Never present a threshold as measured.
5. **The scan figure is an order-of-magnitude range** derived from the throughput assumptions,
   never a measurement.
6. **Every ceiling is derived, never asserted.** There is no fixed "pgvector stops at one
   million rows" number anywhere in the model, and there must not be one. The flat-scan
   ceiling comes from the latency target, the dimensions and the throughput assumption; the
   HNSW ceiling comes from the memory budget, the dimensions and the graph overhead. A reader
   running four million rows on pgvector is not wrong, and the tool has to agree with them
   when their hardware supports it.
7. **No single capability forces a dedicated store.** Hybrid search, multi-tenancy, constant
   churn, air-gapped and edge deployment are all things Postgres does. Each is a
   `Consideration` with prose saying how Postgres meets it, not a `Reason`. Escalation needs
   demands to stack *and* the workload to be past its flat ceiling. Air-gapped is never a
   reason at any scale.

If a request conflicts with any of these, stop and raise it rather than implementing it.

Rules 6 and 7 came out of engineering review of the live page. `lib/__tests__/decision.test.ts`
opens with a "review findings stay fixed" block that encodes each finding as a test. Treat a
failure there as a regression in the argument, not a stale expectation.

## Privacy rules

The product this page promotes is sold on data sovereignty, so the page has to hold to the
same standard.

- **No cookies and no analytics vendor.** No Google Analytics, no tag manager, no Segment,
  no Hotjar, no ad or tracking pixel. An end-to-end test asserts the page sets no cookies and
  loads nothing from a known analytics or tag-manager domain. Those tests are the contract.
  Fonts are self-hosted from `fonts/` and nothing currently loads from another origin, so
  prefer to keep it that way unless there is a reason.
- **Telemetry is first-party, anonymous and off by default.** `lib/telemetry.ts` sends the
  workload shape and the resulting tier so the team can see what people actually size for.
  It is inert unless `NEXT_PUBLIC_TELEMETRY_ENDPOINT` is set, honors
  Do Not Track and Global Privacy Control, uses no cookies and no persistent identifier, and
  offers an opt-out. Do not add fields that could identify a person. The memory cost inputs
  (`COST_ASSUMPTIONS`) are never sent, not even their names, and a unit test checks it.
- **Whatever the page claims must be true.** The footer says "No cookies and no analytics"
  and a test checks it. If you change what the page does, change the claim in the
  same commit. The telemetry disclosure renders only when an endpoint is configured, so the
  page never says it sends something it does not send.

## Changing the model

Thresholds live in `DEFAULT_ASSUMPTIONS` in `lib/assumptions.ts` and flow through `decide()`.
Changing a default changes everyone's result, so prefer leaving defaults alone and letting
users override them in the assumptions panel.

The assumptions are physical quantities, not verdicts:

| Key | What it is |
|---|---|
| `ramBudgetGb` | Memory available to the index. Both ceilings scale with it. |
| `hnswMemoryOverhead` | Graph structure on top of the raw vectors, as a multiplier. |
| `gflopsLow` / `gflopsHigh` | Effective throughput range for a brute-force scan. |
| `heavyFilterCeiling` | Where filtering on every query starts to strain one Postgres. |
| `bytesPerComponentF32` / `bytesPerComponentInt8` | Fixed, not user editable. |

Two derived ceilings fall out of those, in `lib/compute.ts`:

- `flatCeiling(w, a)` is the smaller of what the latency target allows
  (`latency x gflopsHigh / (2 x dims)`) and what memory holds.
- `pgvectorCeiling(w, a)` is `ramBudgetGb / (dims x 4 bytes x hnswMemoryOverhead)`.

This is why dimensions change the verdict at a fixed item count, and why raising the memory
budget moves the boundary instead of being ignored. Do not reintroduce a fixed item count
anywhere in this path.

`decide()` returns two separate lists. `reasons` are what produced the tier. `considerations`
are demands the workload has that did *not* produce it, each carrying `handledBy` prose
naming how Postgres meets it. Both render, and both go into the exported decision record. If
you add a new workload capability, it is a consideration until there is an argument for why
Postgres cannot meet it.

Add a new assumption by extending `Assumptions`, `DEFAULT_ASSUMPTIONS` and `ASSUMPTION_FIELDS`.
URL encoding and the exported record pick it up automatically.

If any of these ever become measured rather than estimated, update the "How this tool decides"
copy in `app/page.tsx` in the same change so the page does not claim more than it can support.

## The memory cost estimate

`components/InfraCostCard.tsx` and `components/CostChart.tsx` price the memory a workload
needs. Hardware only: never a database price, Actian's or anyone else's.

- Memory needed (decimal GB) = items x dims x 4 bytes x `hnswMemoryOverhead` x `headroom`.
  Both multipliers are rules of thumb and stay labeled as estimates.
- Monthly cost = memory x price per decimal GB-month, as low, mid and high. Prices come from
  `data/memory-prices.json` (per-instance hourly list prices) through `lib/prices.ts`, which
  converts per GiB to per decimal GB. Skipping that conversion overstates cost by about 7%.
- Tiers 0, 2 and 3 show the estimate identically (`hasMemoryEstimate()`); tier 1 shows none.
  Do not make it louder on tier 3.
- The chart draws only what `costSeries()` computed, from the same functions as the card,
  so the band, the tooltip and the screen-reader table cannot disagree.
- Managed Postgres is a separate line and renders only when `managedPostgres` in the data
  file has a verified entry. It is empty today.
- `data/memory-prices.json` is rewritten weekly by `scripts/refresh-prices.mjs` through a
  pull request a person reviews. Do not hand-edit prices without updating `fetchedAt` and
  `sourceUrl`. Older than 60 days, the page shows a staleness warning.

## Adding or changing a link

Every outbound URL must be verified live before it ships. Dead links on a page people
bookmark and share are expensive.

Add it to `LINKS` in `lib/links.ts` and reference it from `readsFor()` or the hub list in
`app/page.tsx`. UTM tagging is applied by `withUtm()`; do not hand-write query strings.

## Copy rules

- **No em dashes anywhere.** Rewrite the construction.
- US English, sentence case.
- Plain, technical, a little opinionated. No marketing fluff.
- Active voice. A button names what happens when you press it.

## Quality floor

- Works down to 390px, including the sticky verdict bar below 1000px
- Visible keyboard focus on every interactive element
- `prefers-reduced-motion` respected, animation disabled and values set directly
- No console errors, no hydration warnings
- Every input round-trips through the URL, so a shared link reproduces the result exactly
- `npm audit --omit=dev --audit-level=high` clean, enforced in CI

## Animation

Four things animate, all responding to a user action rather than page load: the arc gauge
sweep, the count-up on the cost table, the active tier in the gauge legend, and the "Cost as
you scale" curve easing to its new shape. Do not add scroll-triggered reveals or hover
transitions on every card.

## Deploy

Push to `main`. The workflow in `.github/workflows/deploy.yml` typechecks, lints, unit tests,
audits, builds, runs end-to-end tests against the built export, then publishes to Pages.
`BASE_PATH` is set from the repository name so asset paths resolve on a project site.
