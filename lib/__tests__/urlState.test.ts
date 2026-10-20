import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../assumptions';
import { readCampaign, withUtm } from '../links';
import {
  DEFAULT_WORKLOAD,
  decodeState,
  encodeState,
  mergeIntoLocation,
} from '../urlState';
import type { Assumptions, Workload } from '../types';

const roundTrip = (w: Workload, a: Assumptions = DEFAULT_ASSUMPTIONS) =>
  decodeState(encodeState(w, a).toString());

describe('url state', () => {
  it('round-trips a non-default workload exactly', () => {
    const w: Workload = {
      items: 10_000_000,
      growth: 10,
      dims: 3072,
      latencyMs: 10,
      qps: 101,
      filtering: 'always',
      matching: 'hybrid',
      changeRate: 'constant',
      tenancy: 'many',
      residency: 'airgapped',
      postgres: true,
    };
    expect(roundTrip(w).workload).toEqual(w);
  });

  it('round-trips a custom item count that is not a slider stop', () => {
    const w = { ...DEFAULT_WORKLOAD, items: 250_000 };
    expect(roundTrip(w).workload.items).toBe(250_000);
  });

  it('round-trips overridden assumptions', () => {
    const a: Assumptions = { ...DEFAULT_ASSUMPTIONS, ramBudgetGb: 128 };
    expect(roundTrip(DEFAULT_WORKLOAD, a).assumptions.ramBudgetGb).toBe(128);
  });

  it('omits assumptions left at their defaults', () => {
    expect(encodeState(DEFAULT_WORKLOAD, DEFAULT_ASSUMPTIONS).toString()).not.toContain('a.');
  });

  it('falls back to defaults on hostile or missing input', () => {
    const { workload, assumptions } = decodeState(
      '?n=notanumber&g=-5&d=0&l=999&q=abc&f=drop%20table&m=&r=mars&p=maybe',
    );
    expect(workload.latencyMs).toBe(DEFAULT_WORKLOAD.latencyMs);
    expect(workload.filtering).toBe(DEFAULT_WORKLOAD.filtering);
    expect(workload.residency).toBe(DEFAULT_WORKLOAD.residency);
    expect(workload.dims).toBeGreaterThanOrEqual(2);
    expect(workload.postgres).toBe(false);
    expect(assumptions).toEqual(DEFAULT_ASSUMPTIONS);
  });

  it('clamps an out-of-range assumption rather than trusting it', () => {
    const { assumptions } = decodeState('?a.ramBudgetGb=999999999999');
    expect(assumptions.ramBudgetGb).toBeLessThanOrEqual(4096);
  });

  it('preserves utm_campaign when writing state back', () => {
    const next = mergeIntoLocation(
      'https://example.com/?utm_campaign=example&n=0',
      { ...DEFAULT_WORKLOAD, items: 10_000_000 },
      DEFAULT_ASSUMPTIONS,
    );
    expect(next).toContain('utm_campaign=example');
    expect(decodeState(new URL(next).search).workload.items).toBe(10_000_000);
  });
});

describe('campaign attribution', () => {
  it('inherits a valid campaign from the page url', () => {
    expect(readCampaign('?utm_campaign=example')).toBe('example');
  });

  it('falls back to organic for a missing or malformed campaign', () => {
    expect(readCampaign('')).toBe('organic');
    expect(readCampaign('?utm_campaign=' + 'x'.repeat(200))).toBe('organic');
    expect(readCampaign('?utm_campaign=<script>')).toBe('organic');
  });

  it('tags every outbound link with source, medium and campaign', () => {
    const tagged = withUtm('https://www.actian.com/databases/vectorai-db/', 'example');
    const q = new URL(tagged).searchParams;
    expect(q.get('utm_source')).toBe('vector-db-calculator');
    expect(q.get('utm_medium')).toBe('hub');
    expect(q.get('utm_campaign')).toBe('example');
  });

  it('keeps any query string the destination already had', () => {
    const tagged = withUtm('https://example.com/page?ref=keepme', 'organic');
    expect(new URL(tagged).searchParams.get('ref')).toBe('keepme');
  });
});
