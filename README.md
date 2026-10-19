# Do you need a vector database?

A sizing tool for Actian VectorAI DB. It takes a description of an agent or RAG workload and
returns one honest recommendation, from a flat file up to a dedicated vector database.

Live: https://actian-devs.github.io/vector-db-calculator/

## Quick start

```bash
npm ci
npm run dev          # http://localhost:3000
npm run verify       # typecheck, unit tests, build
npm run test:e2e     # end-to-end against the built export
```

Node 22 or newer.

## What it does

Eleven inputs across five groups (workload size, performance target, query shape, operations,
deployment) produce one of four verdicts:

| Tier | Verdict | When |
|---|---|---|
| 0 | You don't need a vector database yet | A flat in-memory scan fits at the chosen latency target, with no filtering, one workspace, low concurrency |
| 1 | You need keyword search, not vectors | Queries are exact terms rather than meaning |
| 2 | pgvector will carry you for now | Past a flat scan but within what one Postgres instance can index on the memory you have |
| 3 | You need a dedicated vector database | Past that memory-derived ceiling, filtering on every query at scale, or several operational demands stacking on a workload that has already outgrown a flat scan |

The verdict recalculates on every change. There is no submit step.

### The ceilings are derived, not asserted

There is no fixed "pgvector stops at a million rows" anywhere in the model. Both boundaries
are computed from the inputs:

- The **flat-scan ceiling** is the smaller of what the latency target allows
  (`latency x throughput / (2 x dimensions)`) and what fits in the memory budget. One million
  384-dimension vectors scan in roughly 77ms; the same count at 3072 dimensions takes eight
  times as long and lands in a different tier. Dimensions change the answer, as they should.
- The **pgvector ceiling** is `memory / (dimensions x 4 bytes x HNSW overhead)`. On the
  default 32GB it is about 3.5M at 1536 dimensions and 14M at 384. Raise the memory budget
  and it moves.

No single capability forces a dedicated store either. Hybrid search, multi-tenancy, constant
churn and air-gapped deployment are things Postgres does, so each is listed under "things to
design for" with the way Postgres meets it, not used as grounds for escalating. Escalation
needs those demands to stack *and* the workload to be past its flat ceiling, and the bar is
higher when you already run Postgres.

### What makes it usable for a real decision

- **Every assumption is editable.** The memory budget, the HNSW overhead and the throughput
  range are visible in an assumptions panel and can be replaced with figures from your own
  hardware. The verdict recalculates, and what you set travels with the shared link.
- **Today against twelve months.** The cost table shows both, so the consequence of the growth
  setting is visible rather than folded into one number.
- **Each reason is traceable.** Reasons that come from a threshold record which assumption
  produced them.
- **The demands that did not decide it are shown anyway.** A reviewer's first objection is
  usually "but Postgres does that". The page answers it in advance rather than leaving the
  demand unmentioned.
- **The result can leave the page.** Copy it as Markdown for an ADR or a ticket, or download
  JSON. The record carries the assumptions actually used and the considerations that were
  weighed, so a reviewer can tell whether the model was calibrated or taken as shipped.

## Architecture

`lib/` is the decision model and is framework-free. It imports nothing from React or the DOM,
so it is unit tested directly and could be reused elsewhere. Components are presentational;
`components/Calculator.tsx` owns state and wires the two together.

Static export, so the build is plain files with no server. It runs on GitHub Pages, any CDN,
or inside an air-gapped network.

## Tests

90 in total. Run both before pushing.

```bash
npm run test       # 55 unit tests over the decision model, formatting and URL state
npm run test:e2e   # 35 browser tests, desktop and mobile, against the built export
```

The unit tests pin the model: tier outcomes, that assumptions actually drive the result, that
growth is decided on the twelve-month count, and that hostile query strings fall back rather
than breaking. Several cases exist to catch thresholds being tuned toward the paid tier.

`lib/__tests__/decision.test.ts` opens with a block named "review findings stay fixed". Each
case there is something a reader challenged us on, kept as a test so it cannot quietly come
back: that a flat scan is never claimed to meet a target the scan estimate misses, that
dimensions change the verdict at a fixed item count, and that the pgvector ceiling scales
with memory rather than sitting at one million.

The end-to-end tests pin what only a browser can show: that the UI is wired to the model, that
a shared link reproduces a result exactly, and that the privacy claims hold at runtime. Two of
them assert the page makes zero third-party requests and sets no cookies. Treat those as the
contract behind the footer claim.

## Privacy and telemetry

The page makes **no third-party requests**. Fonts are self-hosted, both SIL OFL 1.1, licences
in `fonts/`. Nothing is sent to an analytics vendor, a tag manager or a CDN.

There is optional **first-party anonymous telemetry**, which exists to give the team the
distribution of workload shapes people evaluate as evidence for pricing. It sends the eleven
inputs, the resulting tier and which assumptions were overridden by name. It carries no
cookie, no persistent identifier and nothing about the person.

It is **off unless an endpoint is configured**, so the tool ships inert.

### Before turning it on

Two obligations the client code cannot enforce:

1. **Get legal sign-off.** The audience is substantially EU-based and the product is positioned
   on GDPR and data sovereignty. Confirm the lawful basis before collecting anything.
2. **The receiving endpoint must not log IP addresses.** If it does, the collection stops being
   anonymous and the disclosure on the page becomes false.

Then set the repository variable `TELEMETRY_ENDPOINT` to a first-party Actian URL. The workflow
passes it through as `NEXT_PUBLIC_TELEMETRY_ENDPOINT` at build time.

Once configured, the page shows a visible disclosure explaining what is sent and why, with an
opt-out. It renders only when an endpoint is set, so the page never claims to send something it
does not send. Do Not Track and Global Privacy Control are honoured regardless.

## Campaign tracking

Every outbound link is tagged at render:

```
?utm_source=vector-db-calculator&utm_medium=hub&utm_campaign=<campaign>&utm_content=tier-<n>
```

`<campaign>` is inherited from the page's own `utm_campaign`, so a visitor arriving on
`...?utm_campaign=7wdata` carries it through to every blog and product link. It falls back to
`organic`. `utm_content` carries the tier, so Actian's existing analytics can see which verdict
drove a click without any tracking on this page.

```
https://actian-devs.github.io/vector-db-calculator/?utm_campaign=7wdata
```

## Deploy

Push to `main`. `.github/workflows/deploy.yml` typechecks, lints, unit tests, audits
dependencies, builds, runs end-to-end tests against the built export, then publishes to Pages.

Enable it once under **Settings, Pages, Source: GitHub Actions**.

`BASE_PATH` is set from the repository name so asset paths resolve on a project site. If the
site moves to a custom domain, set `NEXT_PUBLIC_SITE_URL` and clear `BASE_PATH`.

CI runs a plain `npm ci`. Omitting optional dependencies would also drop the platform binaries
that rollup (used by Vitest) and Next's SWC compiler ship as optional packages, which breaks the
test step. `sharp` gets installed but is never loaded, because `images.unoptimized` is set.

## Working on this with an AI agent

`AGENTS.md` carries the context an agent needs and `.github/copilot-instructions.md` the
condensed version. Point your assistant at `AGENTS.md` before letting it change anything. The
honesty and privacy constraints here are easy to break by accident, and a generic "improve
conversion" prompt will break them. The tests are written so that most such changes fail loudly.
