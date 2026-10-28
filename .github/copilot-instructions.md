# Copilot instructions

Full context is in [`AGENTS.md`](../AGENTS.md). Read it before any non-trivial change. The
essentials:

**Stack.** Next.js 16 App Router, React 19, TypeScript strict, static export
(`output: 'export'`). No server. Build output is plain files.

**Keep `lib/` framework-free.** It holds the decision model and imports nothing from React or
the DOM, so it stays unit testable and reusable. Business rules go in `lib/`, never in
components. There is one derivation path: state changes, `decide()` runs, the UI re-renders
from its result.

**Google Analytics 4 is the only analytics vendor.** The measurement ID is
`GA_MEASUREMENT_ID` in `lib/analytics.ts` (the ID actian.com already loads). Consent Mode v2
keeps storage denied until the visitor accepts. The placeholder `G-XXXXXXXXXX` loads nothing.
No other vendor and no tracking pixel. Fonts stay self-hosted. End-to-end tests assert that
cookies stay unset before consent, and that input changes update the URL without another
pageview. Outbound UTMs are unchanged.

**Telemetry is first-party, anonymous, off by default.** It is inert unless
`NEXT_PUBLIC_TELEMETRY_ENDPOINT` is set, honours Do Not Track and Global Privacy Control, uses
no cookies or persistent identifier, and has an opt-out. Never add a field that could identify
a person. Do not route GA4 through it.

**Whatever the page claims must be true.** If you change what it does, change the claim in the
same commit. A test checks the footer wording.

**Never add performance numbers.** No benchmark, no charts, no VectorAI DB latency or recall
figures, no competitor performance claims. Tier 3 is reached from the shape of the workload,
then the page links out. The page sizes workloads, it does not compare products.

**Never tune the result toward the product.** Tiers 0 and 1 are real outcomes with equal
visual weight to tier 3. Do not raise tier 3's prominence, soften the lower tiers, or adjust
`DEFAULT_ASSUMPTIONS` to route more users to the paid tier. Unit tests assert the lower tiers
stay reachable.

**Keep the arithmetic honest.** Memory and comparison counts are exact. Tier break points are
estimates, labelled as a rough guide, and editable by the user. The scan figure is an
order-of-magnitude range.

**Copy.** No em dashes, ever. Rewrite the construction. US English, sentence case, plain and
technical.

**Verify every outbound link is live** before adding it. Links live in `LINKS` in
`lib/links.ts`; UTMs come from `withUtm()`, never hand-written.

**Before pushing:** `npm run verify`, then `npm run test:e2e`.
