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

  test('an air-gapped deployment needs a dedicated store', async ({ page }) => {
    await page.goto('./');
    await pick(page, 'res', 'air-gapped');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 3');
  });

  test('growth alone can change the verdict', async ({ page }) => {
    await page.goto('./');
    await setItems(page, 3); // 1M
    await pick(page, 'lat', '<200ms');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 0');
    await pick(page, 'growth', '10x');
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 3');
  });

  test('the verdict always explains itself', async ({ page }) => {
    await page.goto('./');
    await pick(page, 'tenancy', 'many tenants');
    const reasons = page.getByTestId('reasons').locator('li');
    await expect(reasons.first()).toContainText(/tenant/i);
    expect(await reasons.count()).toBeGreaterThan(0);
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
    await page.goto('./?n=999&l=abc&r=mars&a.pgvectorCeiling=notanumber');
    await expect(page.getByTestId('tier-badge')).toBeVisible();
    await expect(page.getByTestId('verdict')).not.toBeEmpty();
  });
});

test.describe('assumptions are editable', () => {
  test('raising the pgvector ceiling changes the verdict', async ({ page }) => {
    await page.goto('./');
    await setItems(page, 4); // 10M
    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 3');

    await page.locator('.acard summary').click();
    const input = page.locator('input[data-assumption="pgvectorCeiling"]');
    await input.fill('100000000');
    await input.dispatchEvent('change');

    await expect(page.getByTestId('tier-badge')).toHaveText('TIER 2');
    await expect(page.locator('.a-flag')).toHaveText('EDITED');
  });

  test('an overridden assumption travels with the link', async ({ page }) => {
    await page.goto('./');
    await page.locator('.acard summary').click();
    await page.locator('input[data-assumption="pgvectorCeiling"]').fill('5000000');
    await page.waitForFunction(() => window.location.search.includes('a.pgvectorCeiling'));
    expect(page.url()).toContain('a.pgvectorCeiling=5000000');
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
    await pick(page, 'res', 'air-gapped');
    await page.getByTestId('copy-markdown').click();

    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('# Vector store sizing decision');
    expect(text).toContain('You need a dedicated vector database');
    expect(text).toContain('air-gapped');
    expect(text).toContain('## Assumptions used');
    // The record must say whether the model was calibrated or taken as shipped.
    expect(text).toMatch(/Shipped defaults, unchanged|overridden by the author/);
  });
});

test.describe('privacy claims hold at runtime', () => {
  test('the page makes no third-party request', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const host = new URL(r.url()).host;
      if (host && !host.startsWith('127.0.0.1') && !host.startsWith('localhost')) {
        external.push(r.url());
      }
    });
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    expect(external).toEqual([]);
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
    await expect(page.locator('footer')).toContainText('No cookies and no third-party trackers');
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
    await pick(page, 'res', 'air-gapped');
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
  test('declares a favicon that resolves under the base path', async ({ page, request }) => {
    await page.goto('./');
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    const res = await request.get(new URL(href!, page.url()).toString());
    expect(res.status()).toBe(200);
  });
});
