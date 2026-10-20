import { changedAssumptions, COST_ASSUMPTIONS } from './assumptions';
import type { Assumptions, Decision, Workload } from './types';

/**
 * First-party anonymous telemetry.
 *
 * Purpose: give the team the distribution of workload shapes people evaluate,
 * so the model can be checked against real use. Nothing here identifies a person.
 *
 * Rules this module enforces, and that must not be relaxed:
 *
 *  - Disabled unless NEXT_PUBLIC_TELEMETRY_ENDPOINT is set, so the tool ships
 *    inert and only sends anything once Actian provides an endpoint.
 *  - First party only. No third-party script, no tag manager, no pixel.
 *  - No cookies, no persistent identifier, no fingerprinting. The only thing
 *    stored is the user's own opt-out choice.
 *  - Do Not Track and Global Privacy Control are honoured.
 *  - Payload carries the workload shape and the verdict. Nothing else.
 *
 * Two things this module cannot enforce and that are deployment obligations,
 * documented in the README: the receiving endpoint must not log IP addresses,
 * and the collection needs legal sign-off before it goes live.
 */

const ENDPOINT = process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT ?? '';
const OPT_OUT_KEY = 'vdbc:telemetry-opt-out';

/**
 * The body is JSON, but it is sent as text/plain deliberately.
 *
 * application/json is not a CORS-safelisted content type, so a cross-origin
 * beacon carrying it triggers an OPTIONS preflight. Collectors that do not
 * answer the preflight never receive the POST at all, and the failure is
 * silent, which would mean collecting nothing while appearing to work.
 * text/plain is safelisted, so the request goes straight out.
 *
 * The receiving endpoint must parse the body as JSON regardless of this header.
 */
const BEACON_CONTENT_TYPE = 'text/plain;charset=UTF-8';

/** Sends settle before firing, so we record the workload people land on. */
const SETTLE_MS = 2500;
/** Hard cap per page load, so an indecisive session cannot flood the data. */
const MAX_PER_LOAD = 8;

export interface TelemetryPayload {
  /** Schema version, so the receiver can evolve without guessing. */
  v: 1;
  /** Random per page load. Never persisted, so it cannot link sessions. */
  evaluationGroup: string;
  workload: Workload;
  tier: number;
  itemsAfterGrowth: number;
  /** Which model assumptions the user overrode, by name. Never values, never cost inputs. */
  assumptionsChanged: string[];
  campaign: string;
}

let sent = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let group: string | null = null;

function evaluationGroup(): string {
  if (group === null) {
    group =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
  }
  return group;
}

export function isConfigured(): boolean {
  return ENDPOINT.length > 0;
}

function signalsOptOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const nav = navigator as Navigator & {
    doNotTrack?: string;
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  };
  if (nav.globalPrivacyControl === true) return true;
  const dnt =
    nav.doNotTrack ??
    nav.msDoNotTrack ??
    (typeof window !== 'undefined'
      ? (window as Window & { doNotTrack?: string }).doNotTrack
      : undefined);
  return dnt === '1' || dnt === 'yes';
}

export function hasOptedOut(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    // Storage blocked. Treat as opted out rather than assuming consent.
    return true;
  }
}

const optOutListeners = new Set<() => void>();

/** Lets the disclosure re-render when the choice changes. */
export function subscribeToOptOut(callback: () => void): () => void {
  optOutListeners.add(callback);
  return () => optOutListeners.delete(callback);
}

export function setOptedOut(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(OPT_OUT_KEY, '1');
    else window.localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // Nothing to do. The absence of storage already means no sending.
  }
  optOutListeners.forEach((l) => l());
}

export function isEnabled(): boolean {
  return isConfigured() && !signalsOptOut() && !hasOptedOut();
}

export function buildPayload(
  workload: Workload,
  assumptions: Assumptions,
  decision: Decision,
  campaign: string,
): TelemetryPayload {
  return {
    v: 1,
    evaluationGroup: evaluationGroup(),
    workload,
    tier: decision.tier,
    itemsAfterGrowth: decision.items12,
    // Cost inputs are never sent, not even their names.
    assumptionsChanged: changedAssumptions(assumptions).filter((k) => !COST_ASSUMPTIONS.has(k)),
    campaign,
  };
}

/**
 * Queue one evaluation. Debounced, capped, and silent on failure.
 * Telemetry must never block or degrade the tool.
 */
export function recordEvaluation(
  workload: Workload,
  assumptions: Assumptions,
  decision: Decision,
  campaign: string,
): void {
  if (!isEnabled()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (sent >= MAX_PER_LOAD || !isEnabled()) return;
    sent += 1;
    const body = JSON.stringify(
      buildPayload(workload, assumptions, decision, campaign),
    );
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: BEACON_CONTENT_TYPE }));
        return;
      }
      void fetch(ENDPOINT, {
        method: 'POST',
        body,
        headers: { 'Content-Type': BEACON_CONTENT_TYPE },
        keepalive: true,
        credentials: 'omit',
        mode: 'no-cors',
      }).catch(() => undefined);
    } catch {
      // Swallow. A failed send is never worth surfacing to the user.
    }
  }, SETTLE_MS);
}

export function resetForTests(): void {
  sent = 0;
  group = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
