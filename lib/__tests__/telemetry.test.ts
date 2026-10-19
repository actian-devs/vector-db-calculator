import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../assumptions';
import { decide } from '../decision';
import { buildPayload, isConfigured } from '../telemetry';
import { DEFAULT_WORKLOAD } from '../urlState';

/**
 * Telemetry exists to give the team the distribution of workload shapes people
 * evaluate, as evidence for pricing. These tests pin the privacy properties
 * that justify collecting it at all.
 */
describe('telemetry privacy properties', () => {
  it('is inert unless an endpoint is configured', () => {
    // No NEXT_PUBLIC_TELEMETRY_ENDPOINT in the test environment, so the tool
    // ships sending nothing until Actian supplies one.
    expect(isConfigured()).toBe(false);
  });

  it('carries the workload shape and nothing identifying', () => {
    const decision = decide(DEFAULT_WORKLOAD, DEFAULT_ASSUMPTIONS);
    const payload = buildPayload(
      DEFAULT_WORKLOAD,
      DEFAULT_ASSUMPTIONS,
      decision,
      'organic',
    );

    expect(Object.keys(payload).sort()).toEqual(
      [
        'assumptionsChanged',
        'campaign',
        'evaluationGroup',
        'itemsAfterGrowth',
        'tier',
        'v',
        'workload',
      ].sort(),
    );

    const serialised = JSON.stringify(payload).toLowerCase();
    ['email', 'userid', 'user_id', 'ip', 'referrer', 'useragent', 'cookie'].forEach(
      (forbidden) => expect(serialised).not.toContain(forbidden),
    );
  });

  it('reports which assumptions were overridden, never their values', () => {
    const custom = { ...DEFAULT_ASSUMPTIONS, ramBudgetGb: 128 };
    const payload = buildPayload(
      DEFAULT_WORKLOAD,
      custom,
      decide(DEFAULT_WORKLOAD, custom),
      'organic',
    );
    expect(payload.assumptionsChanged).toEqual(['ramBudgetGb']);
    expect(JSON.stringify(payload)).not.toContain('128');
  });

  it('sends as text/plain so the beacon is not blocked by a preflight', () => {
    // application/json is not CORS-safelisted, so a cross-origin beacon
    // carrying it triggers an OPTIONS preflight. A collector that does not
    // answer that preflight receives nothing, silently, which looks exactly
    // like working. Verified against a real collector before pinning this.
    const source = readFileSync(join(__dirname, '..', 'telemetry.ts'), 'utf8');
    expect(source).toContain("BEACON_CONTENT_TYPE = 'text/plain;charset=UTF-8'");
    expect(source).not.toContain("'application/json'");
  });

  it('matches the verdict the user actually saw', () => {
    // Past the memory-derived HNSW ceiling, so genuinely tier 3.
    const workload = { ...DEFAULT_WORKLOAD, items: 50_000_000, dims: 1536 };
    const decision = decide(workload, DEFAULT_ASSUMPTIONS);
    const payload = buildPayload(workload, DEFAULT_ASSUMPTIONS, decision, 'organic');
    expect(payload.tier).toBe(decision.tier);
    expect(payload.tier).toBe(3);
  });
});
