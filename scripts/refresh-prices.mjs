#!/usr/bin/env node
/**
 * Weekly memory price refresh. Run by .github/workflows/refresh-prices.yml,
 * which opens a pull request with the result for a person to review.
 *
 *   node scripts/refresh-prices.mjs [--dry-run]
 *
 * Writes data/memory-prices.json when at least one source refreshed, and the
 * pull request body to $PR_BODY_FILE (default prices-pr.md). A source that
 * fails keeps its last good entry. If every source fails, nothing is written
 * and the script exits 1 so the failed run is visible.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchAwsHourly, fetchGcpHourly, mergePrices, prBody } from './price-sources.mjs';

const DATA = fileURLToPath(new URL('../data/memory-prices.json', import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const today = new Date().toISOString().slice(0, 10);

const prev = JSON.parse(await readFile(DATA, 'utf8'));
const byProvider = Object.fromEntries(prev.entries.map((e) => [e.provider, e]));

const attempt = async (fn) => {
  try {
    return { ok: true, hourlyUsd: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const results = {};
if (byProvider.AWS) results.AWS = await attempt(() => fetchAwsHourly(byProvider.AWS.instance));
if (byProvider.GCP) {
  results.GCP = await attempt(() => fetchGcpHourly(byProvider.GCP.instance, byProvider.GCP.region));
}

const merged = mergePrices(prev, results, today);
const body = prBody(merged, today);
console.log(body);

if (merged.refreshed === 0) {
  console.error('\nEvery source failed. Leaving data/memory-prices.json unchanged.');
  process.exit(1);
}
if (!dryRun) {
  await writeFile(DATA, `${JSON.stringify(merged.file, null, 2)}\n`);
  await writeFile(process.env.PR_BODY_FILE ?? 'prices-pr.md', `${body}\n`);
}
