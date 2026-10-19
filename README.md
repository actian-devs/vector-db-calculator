# Do you need a vector database?

A single-page calculator that takes a developer's agent or RAG workload and returns one honest recommendation, from a flat file up to a dedicated vector database. Built as the landing page for paid newsletter and social campaigns.

Live: https://actian-devs.github.io/vector-db-calculator/

## What it does

Eleven questions (item count, 12-month growth, embedding dimensions, latency target, peak QPS, metadata filtering, matching type, change rate, tenancy, data residency, existing Postgres) produce one of four verdicts:

| Tier | Verdict | When |
|---|---|---|
| 0 | You don't need a vector database yet | A flat in-memory scan fits the item count at the chosen latency target, with no filtering, one workspace, and low QPS |
| 1 | You need keyword search, not vectors | Queries are exact terms (IDs, names, titles, code symbols) rather than meaning |
| 2 | pgvector will carry you for now | Up to roughly 1M items, light filtering, modest concurrency |
| 3 | You need a dedicated vector database | Heavy filtering at scale, past ~1M items, hybrid search, constant updates and deletes, multi-tenant isolation, or air-gapped and edge deployment |

The result panel updates live as inputs change, so there is no submit step.

## Honesty constraints (please keep these)

These are deliberate and should survive future edits.

- **No benchmark, no charts, no performance table, and no VectorAI DB latency or recall figures.** Tier 3 is reached because of the shape of the workload, then the product pages carry the proof.
- **No competitor performance claims.** The comparison posts are linked, and no numbers are restated on this page.
- **Footprint and comparison counts are exact arithmetic** for the chosen inputs. The tier break points are labeled in the UI as a rough guide, not a measurement.
- **The brute-force latency figure is shown as an order-of-magnitude range** with the throughput assumption stated inline.
- **Tier 0 and Tier 1 are real outcomes.** A reader who is told they do not need the product is the reason this page is credible. Do not tune the thresholds to push more people into Tier 3.

## Interface

Two panes on a light background. The left pane holds the eleven inputs grouped into five collapsible sections (workload size, performance target, query shape, operations, deployment). The right pane is the insight panel: verdict card, an animated arc gauge showing where the workload sits on a log scale with the four tiers as a legend, a cost table comparing today against twelve months out, the reasons behind the verdict, and the reads and calls to action.

The right pane is sticky on desktop, so the verdict stays beside the controls and recomputes as you change anything. There is no submit step.

### Animation

Three things animate, all tied to a change the user made rather than to page load:

- The arc gauge sweeps to its new position over 620ms.
- Every number in the cost table counts to its new value over 420ms with a cubic ease-out, re-formatting each frame so units change cleanly (MB to GB and so on).
- The active tier in the gauge legend fades and scales up as the verdict changes.

All of it is disabled under `prefers-reduced-motion`, where values are set directly.

### Responsive

Below 1000px the panes stack and a slim sticky bar appears at the top carrying the live tier badge and verdict, so the result stays visible while answering on a phone. Below 560px the field grid collapses to one column.

## Privacy

No cookies, no analytics, no third-party requests. The two typefaces are self-hosted from `fonts/` rather than loaded from a CDN, which matters for a product positioned on data sovereignty, and it keeps the page working inside a locked-down network. Answers are held in the URL query string and never leave the browser.

Both faces are SIL Open Font License 1.1 and redistributable, with the licences committed alongside them:

- Archivo (headings and prose), weights 500, 600, 700
- JetBrains Mono (all numerals, labels and controls), weights 400, 500, 700

Only the latin subset is included, six woff2 files totalling about 108 KB. The two faces used above the fold are preloaded.

## Campaign tracking

Every outbound link is tagged at runtime:

```
?utm_source=vector-db-calculator&utm_medium=hub&utm_campaign=<campaign>
```

`<campaign>` is read from the page's own `utm_campaign` parameter, so a visitor arriving on
`...?utm_campaign=7wdata` carries `7wdata` through to every blog and product link they click. It falls back to `organic`.

Send campaign traffic to the page with the campaign set, for example:

```
https://actian-devs.github.io/vector-db-calculator/?utm_campaign=7wdata
https://actian-devs.github.io/vector-db-calculator/?utm_campaign=8020ai
```

## Sharing a result

All eleven answers are encoded in the query string (`n`, `g`, `d`, `l`, `q`, `f`, `m`, `c`, `t`, `r`, `p`), so "Copy link to this result" produces a URL that restores the exact inputs. The `utm_campaign` parameter is preserved when state is written back.

## Deploy to GitHub Pages

Static files with no build step.

```
index.html
og-image.png
.nojekyll
fonts/          six woff2 files plus the two OFL licences
README.md
```

**Option A, serve from the repository root (simplest):**

1. Create `vector-db-calculator` under the `actian-devs` org.
2. Commit everything above to `main`.
3. Settings, then Pages, then Source: Deploy from a branch. Branch: `main`, folder: `/ (root)`.

**Option B, serve from `/docs`:**

1. Move `index.html`, `og-image.png`, `.nojekyll` and the whole `fonts/` folder into `docs/`.
2. Settings, then Pages, then Source: Deploy from a branch. Branch: `main`, folder: `/docs`.

Keep `fonts/` next to `index.html` either way, since the `@font-face` and preload paths are relative.

`.nojekyll` stops GitHub from running the files through Jekyll.

After the first deploy, update the `og:url`, `canonical`, `og:image` and `twitter:image` tags in `index.html` if the final URL differs from `https://actian-devs.github.io/vector-db-calculator/`. The image tags use an absolute URL because X, LinkedIn and Slack ignore relative ones.

## Run locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from the filesystem also works.

## Editing the thresholds

The guidance values live in one object near the top of the script block:

```js
var CFG = {
  flatUnder10ms: 1e4,
  flatUnder50ms: 1e5,
  flatUnder200ms: 1e6,
  pgvectorGuide: 1e6,
  heavyFilterStrainsAbove: 1e5
};
```

Changing these shifts the tier boundaries and the colored bands on the ruler together. If these ever become measured rather than estimated, update the wording in the "How this tool decides" section at the same time so the page does not claim more than it can support.

## Adding a link

Outbound links in the hub are plain `<a href>` tags marked `data-out`, which get the UTM applied on load. Links shown in the result panel come from the `L` map in the script block, so add there and reference the key from `readsFor()`.
