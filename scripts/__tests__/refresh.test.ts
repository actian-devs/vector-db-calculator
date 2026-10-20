import { describe, expect, it } from 'vitest';
import { PRICES } from '../../lib/prices';
import {
  fetchAwsHourly,
  mergePrices,
  parseAwsLine,
  parseGcpCsv,
  prBody,
  splitCsv,
} from '../price-sources.mjs';

// Real rows from the AWS us-east-1 bulk CSV, trimmed after the description.
const AWS_ROWS = [
  '"3DHDZ49TQKCDN4HS","JRTCKXETXF","x","OnDemand","$0.7446 per On Demand Linux with SQL Std r7i.xlarge Instance Hour","2026-10-01"',
  '"NV5RCGBJFJ8DUTQT","JRTCKXETXF","x","OnDemand","$0.3322 per On Demand Linux with SQL Web r7i.xlarge Instance Hour","2026-10-01"',
  '"ABCDEF","JRTCKXETXF","x","OnDemand","$0.2646 per On Demand Linux r7i.xlarge Instance Hour","2026-10-01"',
  '"GHIJKL","JRTCKXETXF","x","OnDemand","$0.2910 per Dedicated Linux r7i.xlarge Instance Hour","2026-10-01"',
];

const GCP_CSV = [
  'name,series,description,region,vCpus,memoryGB,hour,month',
  'n2-highmem-4,n2,"4 vCPUs 32 GB RAM",africa-south1,4.0,32.0,0.288244,168.37',
  'n2-highmem-4,n2,"4 vCPUs 32 GB RAM",us-central1,4.0,32.0,0.262028,153.06',
  'n2-highmem-48,n2,"48 vCPUs 384 GB RAM",us-central1,48.0,384.0,3.144336,1836.3',
].join('\n');

describe('AWS source', () => {
  it('reads only the plain on-demand Linux row', () => {
    const prices = AWS_ROWS.map((r) => parseAwsLine(r, 'r7i.xlarge')).filter((p) => p !== null);
    expect(prices).toEqual([0.2646]);
  });

  it('streams and stops at the first match, even split across chunks', async () => {
    const text = `${AWS_ROWS.join('\n')}\n`;
    const chunks = [text.slice(0, 150), text.slice(150, 311), text.slice(311)];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((s) => c.enqueue(new TextEncoder().encode(s)));
        c.close();
      },
    });
    const fakeFetch = (async () => new Response(stream)) as unknown as typeof fetch;
    await expect(fetchAwsHourly('r7i.xlarge', fakeFetch)).resolves.toBe(0.2646);
  });

  it('fails clearly when the row is missing', async () => {
    const fakeFetch = (async () => new Response('"a","b"\n')) as unknown as typeof fetch;
    await expect(fetchAwsHourly('r7i.xlarge', fakeFetch)).rejects.toThrow(/no on-demand Linux row/);
  });
});

describe('GCP source', () => {
  it('reads the hourly price for one machine type in one region', () => {
    expect(parseGcpCsv(GCP_CSV, 'n2-highmem-4', 'us-central1')).toBe(0.262028);
  });

  it('handles quoted fields with commas', () => {
    expect(splitCsv('a,"b, c",d')).toEqual(['a', 'b, c', 'd']);
  });

  it('fails when the region is missing', () => {
    expect(() => parseGcpCsv(GCP_CSV, 'n2-highmem-4', 'europe-west1')).toThrow(/no row/);
  });
});

describe('merging a refresh', () => {
  it('updates prices and dates when both sources succeed', () => {
    const r = mergePrices(
      PRICES,
      { AWS: { ok: true, hourlyUsd: 0.27 }, GCP: { ok: true, hourlyUsd: 0.262028 } },
      '2026-11-01',
    );
    expect(r.refreshed).toBe(2);
    expect(r.file.pricedAt).toBe('2026-11-01');
    expect(r.file.entries.find((e) => e.provider === 'AWS')?.hourlyUsd).toBe(0.27);
    expect(r.flags).toEqual([]);
  });

  it('keeps the last good entry when a fetch fails', () => {
    const r = mergePrices(
      PRICES,
      { AWS: { ok: false, error: 'timeout' }, GCP: { ok: true, hourlyUsd: 0.262028 } },
      '2026-11-01',
    );
    const aws = r.file.entries.find((e) => e.provider === 'AWS');
    const before = PRICES.entries.find((e) => e.provider === 'AWS');
    expect(aws).toEqual(before);
    expect(r.notes.join(' ')).toMatch(/AWS r7i\.xlarge: fetch failed \(timeout\)/);
  });

  it('leaves the whole file untouched when every fetch fails', () => {
    const r = mergePrices(
      PRICES,
      { AWS: { ok: false, error: 'x' }, GCP: { ok: false, error: 'y' } },
      '2026-11-01',
    );
    expect(r.refreshed).toBe(0);
    expect(r.file).toBe(PRICES);
  });

  it('flags a move of more than 15% and leads the PR body with it', () => {
    const r = mergePrices(
      PRICES,
      { AWS: { ok: true, hourlyUsd: 0.2646 * 1.2 }, GCP: { ok: true, hourlyUsd: 0.262028 } },
      '2026-11-01',
    );
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0]).toMatch(/AWS r7i\.xlarge moved 20\.0%/);
    const body = prBody(r, '2026-11-01');
    expect(body.indexOf('Flagged')).toBeLessThan(body.indexOf('Entries'));
  });

  it('does not flag a move of exactly 15% or less', () => {
    const r = mergePrices(
      PRICES,
      { AWS: { ok: true, hourlyUsd: 0.2646 * 1.149 }, GCP: { ok: true, hourlyUsd: 0.262028 } },
      '2026-11-01',
    );
    expect(r.flags).toEqual([]);
  });
});
