/**
 * Pure helpers for the weekly price refresh. No I/O except the two fetchers,
 * which take `fetch` as an argument so tests can stub it.
 *
 * Sources, both public and keyless:
 *  - AWS: the EC2 bulk price list for us-east-1 (about 300 MB of CSV). It is
 *    streamed and abandoned as soon as the one row we need has been read.
 *  - GCP: gcloud-compute.com's machine-types-regions.csv, an Apache-2.0 dataset
 *    built from Google's billing catalog. Google's own pricing page renders its
 *    tables in the browser, and the billing API needs a key, so this is the
 *    keyless source. Its `month` column includes sustained-use discounts, so we
 *    read `hour` and multiply by 730 like every other entry.
 */

export const AWS_URL =
  'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv';
export const GCP_URL = 'https://gcloud-compute.com/machine-types-regions.csv';

/** A move bigger than this between runs is flagged for the reviewer. */
export const FLAG_THRESHOLD = 0.15;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The on-demand, shared-tenancy, plain Linux price for one instance type, read
 * from its description column. The exact wording excludes SQL Server, RHEL,
 * dedicated hosts, reservations and unused capacity, which all say otherwise.
 */
export function parseAwsLine(line, instance) {
  const re = new RegExp(`"\\$([0-9.]+) per On Demand Linux ${escapeRe(instance)} Instance Hour"`);
  const m = line.match(re);
  if (!m) return null;
  const price = Number(m[1]);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Streams the AWS CSV line by line and stops at the first match. */
export async function fetchAwsHourly(instance, fetchImpl = fetch) {
  const controller = new AbortController();
  const res = await fetchImpl(AWS_URL, { signal: controller.signal });
  if (!res.ok || !res.body) throw new Error(`AWS price list returned ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const price = parseAwsLine(line, instance);
        if (price !== null) return price;
      }
    }
    const price = parseAwsLine(buffer, instance);
    if (price !== null) return price;
    throw new Error(`no on-demand Linux row for ${instance} in the AWS price list`);
  } finally {
    controller.abort();
  }
}

/** Splits one CSV record, honoring double-quoted fields. */
export function splitCsv(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

/** The on-demand hourly price for one machine type in one region. */
export function parseGcpCsv(text, instance, region) {
  const lines = text.split(/\r?\n/);
  const header = splitCsv(lines[0]);
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`GCP CSV has no "${name}" column`);
    return i;
  };
  const iName = col('name');
  const iRegion = col('region');
  const iHour = col('hour');
  for (const line of lines.slice(1)) {
    if (!line.startsWith(`${instance},`)) continue;
    const f = splitCsv(line);
    if (f[iName] === instance && f[iRegion] === region) {
      const price = Number(f[iHour]);
      if (Number.isFinite(price) && price > 0) return price;
      throw new Error(`GCP price for ${instance} in ${region} is not a positive number`);
    }
  }
  throw new Error(`no row for ${instance} in ${region} in the GCP CSV`);
}

export async function fetchGcpHourly(instance, region, fetchImpl = fetch) {
  const res = await fetchImpl(GCP_URL);
  if (!res.ok) throw new Error(`GCP price CSV returned ${res.status}`);
  return parseGcpCsv(await res.text(), instance, region);
}

/**
 * Applies fresh prices to the previous file. An entry whose fetch failed keeps
 * its last good value and date, and is reported. Returns the new file, whether
 * anything was refreshed, and the notes and flags for the pull request.
 *
 * results: { [provider]: { ok: true, hourlyUsd } | { ok: false, error } }
 */
export function mergePrices(prev, results, today) {
  const notes = [];
  const flags = [];
  let refreshed = 0;
  const entries = prev.entries.map((e) => {
    const r = results[e.provider];
    if (!r || !r.ok) {
      notes.push(`${e.provider} ${e.instance}: fetch failed (${r ? r.error : 'not attempted'}), kept $${e.hourlyUsd}/h from ${e.fetchedAt}.`);
      return e;
    }
    refreshed += 1;
    const change = (r.hourlyUsd - e.hourlyUsd) / e.hourlyUsd;
    if (Math.abs(change) > FLAG_THRESHOLD) {
      flags.push(
        `${e.provider} ${e.instance} moved ${(change * 100).toFixed(1)}%, from $${e.hourlyUsd}/h to $${r.hourlyUsd}/h. Check the source before merging.`,
      );
    }
    if (r.hourlyUsd !== e.hourlyUsd) {
      notes.push(`${e.provider} ${e.instance}: $${e.hourlyUsd}/h to $${r.hourlyUsd}/h.`);
    } else {
      notes.push(`${e.provider} ${e.instance}: unchanged at $${e.hourlyUsd}/h.`);
    }
    return { ...e, hourlyUsd: r.hourlyUsd, fetchedAt: today };
  });
  return {
    file: refreshed > 0 ? { ...prev, pricedAt: today, entries } : prev,
    refreshed,
    notes,
    flags,
  };
}

/** Pull request body. Flags lead, so a reviewer cannot miss a large move. */
export function prBody({ notes, flags }, today) {
  const lines = [`Weekly memory price refresh, ${today}.`, ''];
  if (flags.length > 0) {
    lines.push(`**Flagged: price moved more than ${FLAG_THRESHOLD * 100}%**`, '');
    flags.forEach((f) => lines.push(`- ${f}`));
    lines.push('');
  }
  lines.push('**Entries**', '');
  notes.forEach((n) => lines.push(`- ${n}`));
  lines.push(
    '',
    'Prices are on-demand list prices, per instance, converted on the page to per decimal GB-month. Review the sources before merging; nothing deploys until this is merged.',
  );
  return lines.join('\n');
}
