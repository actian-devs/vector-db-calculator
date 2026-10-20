import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end checks against the built static export.
 *
 * The unit tests in lib/ already pin the decision model. These cover what only
 * a browser can: that the UI is wired to the model, that state survives a
 * shared link, and that the privacy claims on the page hold at runtime.
 */

async function pick(page: Page, field: string, label: string) {
  await page.locator(`.seg input[data-field="${field}"] + label`, { hasText: label }).first().click();
}

async function setItems(page: Page, stepIndex: number) {
  await page.locator('#items').fill(String(stepIndex));
  await page.locator('#items').dispatchEvent('change');
}

const tier = (page: Page) => page.getByTestId('tier-badge').innerText();

/** Parses the legend's compact counts, for example "to 163K" or "3.5M+". */
function parseCompact(text: string): number {
  const m = text.match(/([\d.]+)\s*([KMB])/);
  if (!m) return Number.NaN;
  return Number(m[1]) * { K: 1e3, M: 1e6, B: 1e9 }[m[2] as 'K' | 'M' | 'B'];
}

test.describe('verdicts', () => {
  test('a small quiet workload is told it does not need one', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 0');
    await expect(page.getByTestId('verdict')).toHaveText(/don't need a vector database yet/i);
  });

  test('exact-term matching is sent to keyword search', async ({ page }) => {
    await page.goto('./');
    await pick(page, 'match', 'exact');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 1');
  });

  test('an air-gapped deployment is a consideration, not a verdict', async ({ page }) => {
    // Postgres self-hosts with no outbound dependency, so the network boundary
    // is not on its own an argument for a commercial database. Engineering
    // review called this out, so the page has to show it was weighed.
    await page.goto('./');
    await pick(page, 'res', 'air-gapped');
    await expect(page.getByTestId('tier-badge')).not.toHaveText('TIER 3');
    await page.locator('.ccard summary').click();
    await expect(page.getByTestId('considerations')).toContainText(/air-gapped/i);
  });

  test('growth alone can change the verdict', async ({ page }) => {
    await page.goto('./');
    await setItems(page, 2); // 100K
    await pick(page, 'lat', '<200ms');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 0');
    await pick(page, 'growth', '10x');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 2');
  });

  test('the verdict always explains itself', async ({ page }) => {
    await page.goto('./');
    await pick(page, 'tenancy', 'many tenants');
    const reasons = page.getByTestId('reasons').locator('li');
    expect(await reasons.count()).toBeGreaterThan(0);
    // The demand itself is listed as something to design for, with the way
    // Postgres meets it, rather than used as grounds for escalating.
    await page.locator('.ccard summary').click();
    const considerations = page.getByTestId('considerations');
    await expect(considerations).toContainText(/tenant/i);
    await expect(considerations).toContainText(/Postgres/);
  });
});

test.describe('shared links', () => {
  test('a copied url reproduces the exact result', async ({ page }) => {
    await page.goto('./?utm_campaign=7wdata');
    await setItems(page, 4);
    await pick(page, 'filter', 'always');
    await pick(page, 'res', 'air-gapped');
    await pick(page, 'growth', '10x');
    const before = await tier(page);
    const shared = page.url();

    await page.goto(shared);
    await expect(page.getByTestId('tier-badge')).toHaveText(before);
    // Campaign attribution survives the state rewrite.
    expect(shared).toContain('utm_campaign=7wdata');
  });

  test('hostile query values fall back instead of breaking', async ({ page }) => {
    await page.goto('./?n=999&l=abc&r=mars&a.ramBudgetGb=notanumber');
    await expect(page.getByTestId('tier-badge')).toBeVisible();
    await expect(page.getByTestId('verdict')).not.toBeEmpty();
  });
});

test.describe('assumptions are editable', () => {
  test('raising the memory budget changes the verdict', async ({ page }) => {
    // The ceiling is derived from memory and dimensions, not asserted as a
    // flat one million rows, so a reader who runs bigger hardware can say so
    // and the tool agrees with them.
    await page.goto('./');
    await setItems(page, 4); // 10M
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 3');

    await page.locator('.acard summary').click();
    const input = page.locator('input[data-assumption="ramBudgetGb"]');
    await input.fill('512');
    await input.press('Enter');

    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 2');
    await expect(page.locator('.a-flag')).toHaveText('EDITED');
  });

  test('an overridden assumption travels with the link', async ({ page }) => {
    await page.goto('./');
    await page.locator('.acard summary').click();
    await page.locator('input[data-assumption="ramBudgetGb"]').fill('128');
    await page.locator('input[data-assumption="ramBudgetGb"]').press('Enter');
    await page.waitForFunction(() => window.location.search.includes('a.ramBudgetGb'));
    expect(page.url()).toContain('a.ramBudgetGb=128');
  });
});

test.describe('export', () => {
  test('produces a decision record naming the verdict and the assumptions', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'clipboard permissions are desktop-only here');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('./');
    await setItems(page, 4); // 10M, past the memory-derived HNSW ceiling
    await pick(page, 'res', 'air-gapped');
    await page.getByTestId('copy-markdown').click();

    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('# Vector store sizing decision');
    expect(text).toContain('You need a dedicated vector database');
    expect(text).toContain('air-gapped');
    expect(text).toContain('## Assumptions used');
    // The demands that did not decide it are in the record too, so a reviewer
    // can see they were weighed rather than ignored.
    expect(text).toContain('## Also weighed, and not grounds on their own');
    // The record must say whether the model was calibrated or taken as shipped.
    expect(text).toMatch(/Shipped defaults, unchanged|overridden by the author/);
  });
});

test.describe('privacy claims hold at runtime', () => {
  test('loads nothing from an analytics or tag-manager domain', async ({ page }) => {
    // The zero-third-party-requests rule was dropped. No analytics vendor stays.
    const TRACKERS =
      /(google-analytics|googletagmanager|doubleclick|segment\.(io|com)|hotjar|facebook\.net|connect\.facebook|clarity\.ms|plausible\.io|mixpanel|amplitude|heap(analytics)?\.(io|com)|fullstory|posthog)/i;
    const hits: string[] = [];
    page.on('request', (r) => {
      if (TRACKERS.test(new URL(r.url()).host)) hits.push(r.url());
    });
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    expect(hits).toEqual([]);
  });

  test('sets no cookies', async ({ page, context }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    expect(await context.cookies()).toEqual([]);
  });

  test('the telemetry notice is absent until an endpoint is configured', async ({ page }) => {
    // Built without NEXT_PUBLIC_TELEMETRY_ENDPOINT, so the tool must not claim
    // to send anything.
    await page.goto('./');
    await expect(page.getByTestId('telemetry-toggle')).toHaveCount(0);
  });

  test('the footer claim matches what the build actually does', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('footer')).toContainText('No cookies and no analytics.');
  });
});

test.describe('outbound links', () => {
  test('every outbound link carries campaign attribution', async ({ page }) => {
    await page.goto('./?utm_campaign=7wdata');

    // This is a static export, so the shipped HTML is identical for every
    // visitor and cannot contain a per-visitor campaign. Attribution is applied
    // once the page hydrates and reads the real query string, so wait for that
    // rather than racing it.
    await expect
      .poll(async () =>
        page
          .locator('a[data-outbound="true"]')
          .first()
          .evaluate((e) => (e as HTMLAnchorElement).href),
      )
      .toContain('utm_campaign=7wdata');

    const hrefs = await page.locator('a[data-outbound="true"]').evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const q = new URL(href).searchParams;
      expect(q.get('utm_source')).toBe('vector-db-calculator');
      expect(q.get('utm_medium')).toBe('hub');
      expect(q.get('utm_campaign')).toBe('7wdata');
      // The tier the reader actually saw, so Actian's own analytics can tell
      // which verdict drove the click without any tracking on this page.
      expect(q.get('utm_content')).toMatch(/^tier-[0-3]$/);
    }
  });
});

test.describe('responsive', () => {
  test('a live verdict bar appears on small screens', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'small screens only');
    await page.goto('./');
    await expect(page.locator('.minibar')).toBeVisible();
    await setItems(page, 4); // 10M
    await expect(page.locator('.minibar b')).toHaveText(/dedicated vector database/i);
  });

  test('the verdict panel is beside the controls on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'large screens only');
    await page.goto('./');
    await expect(page.locator('.minibar')).toBeHidden();
    const controls = await page.locator('.controls').boundingBox();
    const insights = await page.locator('.insights').boundingBox();
    expect(insights!.x).toBeGreaterThan(controls!.x);
  });
});

test.describe('accessibility basics', () => {
  test('exactly one h1, and controls are labelled', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('h1')).toHaveCount(1);
    const groups = page.locator('[role="radiogroup"]');
    const count = await groups.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i += 1) {
      const g = groups.nth(i);
      const labelled =
        (await g.getAttribute('aria-labelledby')) ?? (await g.getAttribute('aria-label'));
      expect(labelled).toBeTruthy();
    }
  });

  test('the skip link reaches the controls', async ({ page }) => {
    await page.goto('./');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
  });
});

test.describe('page identity', () => {
  test('shows the Actian logo from the brand kit', async ({ page }) => {
    await page.goto('./');
    const logo = page.locator('.rail img.logo');
    await expect(logo).toHaveAttribute('alt', 'Actian');
    // naturalWidth is 0 when the file 404s, which is how a missing base path shows up.
    expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test('declares a favicon that resolves under the base path', async ({ page, request }) => {
    await page.goto('./');
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    const res = await request.get(new URL(href!, page.url()).toString());
    expect(res.status()).toBe(200);
  });

  test('social card images point at a file that exists', async ({ page, request }) => {
    await page.goto('./');
    // The tags point at the production site, which may not be where this build
    // is served. So check the image sits directly under the site's own URL (no
    // doubled base path), and that the file exists next to the page here.
    const site = await page.locator('meta[property="og:url"]').getAttribute('content');
    const sitePath = new URL(site!).pathname.replace(/\/?$/, '/');
    for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const content = await page.locator(sel).first().getAttribute('content');
      expect(content).toMatch(/^https:\/\//);
      expect(new URL(content!).pathname, `${sel} -> ${content}`).toBe(`${sitePath}og-image.png`);
    }
    const res = await request.get(new URL('og-image.png', page.url()).toString());
    expect(res.status()).toBe(200);
  });
});

test.describe('considerations card', () => {
  test('does not claim the demands were irrelevant when they stacked', async ({ page }) => {
    // 2M, past the stacking gate at half the pgvector ceiling.
    await page.goto('./?n=3&g=2&m=hybrid&t=many&p=no');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 3');
    await page.locator('.ccard summary').click();
    await expect(page.locator('.c-intro')).toContainText('tipped the verdict');
    await expect(page.locator('.c-intro')).toContainText('many tenants share one store');
  });

  test('says they did not decide it when they did not', async ({ page }) => {
    await page.goto('./?n=3&m=hybrid');
    await expect(page.getByTestId('tier-badge')).not.toHaveText('TIER 3');
    await page.locator('.ccard summary').click();
    await expect(page.locator('.c-intro')).toContainText('did not decide the verdict');
  });
});

test.describe('gauge legend', () => {
  test('derives its ranges instead of printing a fixed 1M', async ({ page }) => {
    await page.goto('./?d=1536');
    const pg = page.locator('.glegend .row[data-t="2"] em');
    const at1536 = await pg.innerText();
    await page.goto('./?d=384');
    await expect(pg).not.toHaveText(at1536);
    await expect(page.locator('.glegend')).not.toContainText('to 1M');
  });

  for (const dims of [384, 3072]) {
    test(`never contradicts the verdict at ${dims} dimensions`, async ({ page }) => {
      // 1M items, flat growth, 200ms: tier 0 at 384 and tier 2 at 3072.
      await page.goto(`./?n=3&g=1&l=200&d=${dims}`);
      const active = page.locator('.glegend .row.on');
      await expect(active).toHaveCount(1);
      const tier = Number(await active.getAttribute('data-t'));
      const badge = await page.getByTestId('tier-badge').innerText();
      expect(badge).toBe(`TIER ${tier}`);
      const range = await active.locator('em').innerText();
      const bound = parseCompact(range);
      if (range.startsWith('to ')) expect(1_000_000).toBeLessThanOrEqual(bound);
      if (range.endsWith('+')) expect(1_000_000).toBeGreaterThan(bound);
    });
  }
});

test.describe('memory cost estimate', () => {
  const pricedAt = (
    JSON.parse(readFileSync(join(__dirname, '..', 'data', 'memory-prices.json'), 'utf8')) as {
      pricedAt: string;
    }
  ).pricedAt;

  for (const [label, query, tierText] of [
    ['tier 0', './', 'TIER 0'],
    ['tier 2', './?n=3&g=1&l=200&d=3072', 'TIER 2'],
    ['tier 3', './?n=5&g=1', 'TIER 3'],
  ] as const) {
    test(`appears the same way for ${label}`, async ({ page }) => {
      await page.goto(query);
      await expect(page.getByTestId('tier-badge')).toHaveText(tierText);
      await expect(page.getByTestId('cost-today')).toBeVisible();
      await expect(page.getByTestId('cost-note')).toContainText('Not a quote');
      await expect(page.getByTestId('cost-chart')).toBeVisible();
    });
  }

  test('is absent for tier 1 and says why', async ({ page }) => {
    await page.goto('./?m=exact');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 1');
    await expect(page.getByTestId('cost-none')).toContainText('Full-text indexes are small');
    await expect(page.getByTestId('cost-today')).toHaveCount(0);
    await expect(page.getByTestId('cost-chart')).toHaveCount(0);
  });

  test('editing the price changes the figure and travels with the link', async ({ page }) => {
    await page.goto('./?n=3&g=1');
    const before = await page.getByTestId('cost-mid-today').innerText();
    await page.locator('.acard summary').click();
    const input = page.locator('input[data-assumption="priceHighPerGbMonth"]');
    await input.fill('20');
    await input.press('Enter');
    await input.dispatchEvent('change');
    await expect(page.getByTestId('cost-mid-today')).not.toHaveText(before);
    await page.waitForFunction(() => window.location.search.includes('a.priceHighPerGbMonth=20'));
    const after = await page.getByTestId('cost-mid-today').innerText();
    await page.goto(page.url());
    await expect(page.getByTestId('cost-mid-today')).toHaveText(after);
  });

  test('the chart tooltip at your workload matches the card', async ({ page }) => {
    await page.goto('./?n=3&g=10');
    await page.locator('.chart-wrap svg').focus();
    await expect(page.getByTestId('chart-tip')).toContainText('Your workload');
    await expect(page.getByTestId('tip-mid')).toHaveText(
      await page.getByTestId('cost-mid-next').innerText(),
    );
  });

  test('has a text table of the same data for screen readers', async ({ page }) => {
    await page.goto('./');
    const rows = page.getByTestId('cost-chart-table').locator('tbody tr');
    await expect(rows).toHaveCount(7);
  });

  test('marks both ceilings when they fall inside the range', async ({ page }) => {
    await page.goto('./?d=1536');
    await expect(page.getByTestId('marker-flat')).toHaveCount(1);
    await expect(page.getByTestId('marker-pg')).toHaveCount(1);
  });

  test('warns when the price file is more than 60 days old', async ({ page }) => {
    const old = new Date(`${pricedAt}T12:00:00Z`);
    old.setUTCDate(old.getUTCDate() + 61);
    await page.clock.setFixedTime(old);
    await page.goto('./');
    await expect(page.getByTestId('cost-stale')).toBeVisible();
  });

  test('shows no warning while the price file is fresh', async ({ page }) => {
    const fresh = new Date(`${pricedAt}T12:00:00Z`);
    fresh.setUTCDate(fresh.getUTCDate() + 5);
    await page.clock.setFixedTime(fresh);
    await page.goto('./');
    await expect(page.getByTestId('cost-note')).toBeVisible();
    await expect(page.getByTestId('cost-stale')).toHaveCount(0);
  });

  for (const [label, query] of [
    ['the default workload', './'],
    ['a tier 3 link with every demand on', './?n=2&g=100&d=3072&l=200&q=101&f=always&m=hybrid&c=append&t=many&r=airgapped&p=no'],
    ['the edge tier 3 headline', './?n=4&d=768&r=edge'],
  ]) {
    test(`fits a 375px screen for ${label}, verdict bar uncut`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(query);
      await expect(page.locator('.minibar')).toBeVisible();
      const { overflow, cut } = await page.evaluate(() => {
        const b = document.querySelector('.minibar b') as HTMLElement;
        return {
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          cut: b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1,
        };
      });
      expect(overflow).toBe(false);
      expect(cut).toBe(false);
    });
  }

  test('fits a 390px screen without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('./?n=3&g=10');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe('assumptions panel labels', () => {
  test('states the real defaults for the multipliers', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('#a-hnswMemoryOverhead-help')).toContainText('Default 1.5.');
    await expect(page.locator('#a-headroom-help')).toContainText('Default 1.3.');
    await expect(page.locator('input[data-assumption="hnswMemoryOverhead"]')).toHaveValue('1.5');
    await expect(page.locator('input[data-assumption="headroom"]')).toHaveValue('1.3');
  });
});

test.describe('QA regressions', () => {
  test('a crafted link with a zero byte size still renders a verdict', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./?n=3&a.bytesPerComponentF32=0');
    await expect(page.getByTestId('tier-badge')).toBeVisible();
    await page.goto('./?n=3&a.bytesPerComponentF32=-4');
    await expect(page.getByTestId('cost-today')).not.toContainText('-');
    expect(errors).toEqual([]);
  });

  test('a bare link opens on the default 100K workload', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByTestId('items-today')).toHaveText('100,000');
  });

  test('an assumption can be typed digit by digit', async ({ page }) => {
    await page.goto('./');
    await page.locator('.acard summary').first().click();
    const ram = page.locator('input[data-assumption="ramBudgetGb"]');
    await ram.fill('');
    await ram.pressSequentially('64');
    await ram.press('Tab');
    await expect(ram).toHaveValue('64');
    await expect.poll(() => page.url()).toContain('a.ramBudgetGb=64');
  });

  test('custom dimensions can be typed through a standard value', async ({ page }) => {
    await page.goto('./');
    await page.locator('label[for="dims-custom"]').click();
    const dims = page.getByTestId('dims-custom-input');
    await dims.fill('');
    await dims.pressSequentially('7680');
    await dims.press('Enter');
    await expect(dims).toHaveValue('7680');
    await expect.poll(() => page.url()).toContain('d=7680');
  });

  test('copy link on a fresh visit copies a link that reproduces the verdict', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'clipboard permissions are desktop-only here');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('./');
    await page.getByRole('button', { name: 'copy link' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^http.*\?.*n=2/);
  });
});

test.describe('before the page hydrates', () => {
  test('the static html shows no verdict a shared link might not hold', async ({ page, request }) => {
    await page.goto('./');
    const html = await (await request.get(page.url())).text();
    expect(html).toContain('Describe your workload to see the verdict');
    expect(html).not.toContain('You don&#x27;t need a vector database yet</h3>');
  });

  test('a landmark wraps the calculator', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('main #controls')).toHaveCount(1);
    await expect(page.locator('main [data-testid="verdict"]')).toHaveCount(1);
  });
});
