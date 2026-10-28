import type { Tier } from './types';

/**
 * Google Analytics 4 for the sizing calculator.
 *
 * The measurement ID below is the only switch. It must be the web stream in
 * the existing "Actian - GA4" property (property id 251080951): Admin, Data
 * streams, Measurement ID. While it is still the placeholder, this module
 * loads nothing and sends nothing, and the page keeps its "no analytics" claim.
 *
 * Cross-domain: the linker decorates links to actian.com and www.actian.com.
 * That stream must also list actian-devs.github.io under Configure your
 * domains, or the session breaks when a visitor continues to actian.com.
 *
 * The calculator rewrites the query string on every input. In the stream's
 * enhanced measurement settings, turn off page changes based on browser
 * history events, or each input is counted as a pageview. The only pageview
 * this module sends is the one on load, with the full URL (base path and UTMs).
 *
 * First-party telemetry in ./telemetry.ts is a separate system. It stays inert
 * unless its own endpoint is set, and it keeps its own payload rules. GA4 is
 * not routed through it. Events here carry the tier and, for an outbound
 * click, the destination. They do not carry the workload or any cost input.
 *
 * Events (mark calculator_result and outbound_cta as key events if useful):
 *   page_view          on load. page_location is the full URL, so UTMs survive.
 *   calculator_result  { tier: "tier-0" | "tier-1" | "tier-2" | "tier-3" }
 *   calculator_started { tier }  once, on the first input change
 *   outbound_cta       { tier, destination }  destination is host + path
 */

/** Replace with the web stream measurement ID. Placeholder sends nothing. */
export const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';

export const GA_MEASUREMENT_ID_PLACEHOLDER = 'G-XXXXXXXXXX';

/** Remembered consent choice. Not a cookie, and not the telemetry opt-out. */
export const CONSENT_KEY = 'vdbc:ga-consent';

export const GA_LINKER_DOMAINS = ['actian.com', 'www.actian.com'] as const;

/**
 * Collapse a burst of tier changes, such as a slider drag, into the tier the
 * reader settled on. The landing verdict uses the same delay so a shared link
 * is recorded once, after the URL has been read.
 */
export const RESULT_SETTLE_MS = 400;

export const GA_EVENT = {
  result: 'calculator_result',
  started: 'calculator_started',
  outbound: 'outbound_cta',
} as const;

const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/i;

export type ConsentChoice = 'granted' | 'denied';

export interface ConsentSettings {
  ad_storage: ConsentChoice;
  ad_user_data: ConsentChoice;
  ad_personalization: ConsentChoice;
  analytics_storage: ConsentChoice;
  functionality_storage: ConsentChoice;
  personalization_storage: ConsentChoice;
  security_storage: 'granted';
}

type Gtag = (...args: unknown[]) => void;

export interface TrackOptions {
  id?: string;
  gtag?: Gtag;
}

/** True only for a real measurement ID. The placeholder and anything else are off. */
export function isGaConfigured(id: string = GA_MEASUREMENT_ID): boolean {
  const value = id.trim();
  return value !== GA_MEASUREMENT_ID_PLACEHOLDER && MEASUREMENT_ID_PATTERN.test(value);
}

export function tierParam(tier: Tier): `tier-${Tier}` {
  return `tier-${tier}`;
}

/** Host and path only, so the query string (UTMs included) is not the dimension. */
export function destinationParam(href: string): string {
  try {
    const url = new URL(href);
    return `${url.hostname}${url.pathname}`.slice(0, 100);
  } catch {
    return href.slice(0, 100);
  }
}

export function consentState(choice: ConsentChoice): ConsentSettings {
  return {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
    functionality_storage: choice,
    personalization_storage: choice,
    security_storage: 'granted',
  };
}

/**
 * Inline bootstrap. Consent defaults to denied before gtag.js is inserted, and
 * a choice already in localStorage is applied before the config pageview, so
 * the first hit matches what the visitor decided on a previous visit.
 * Returns null while the ID is the placeholder, in which case the page must
 * not render a script tag at all.
 */
export function analyticsBootstrap(measurementId: string): string | null {
  if (!isGaConfigured(measurementId)) return null;
  const id = measurementId.trim();
  const denied = JSON.stringify(consentState('denied'));
  const granted = JSON.stringify(consentState('granted'));
  const domains = JSON.stringify([...GA_LINKER_DOMAINS]);
  const key = JSON.stringify(CONSENT_KEY);
  return `
window.__vdbcGa || (window.__vdbcGa = 1, (function () {
  var id = ${JSON.stringify(id)};
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('consent', 'default', ${denied});
  gtag('set', 'ads_data_redaction', true);
  try {
    var choice = window.localStorage.getItem(${key});
    if (choice === 'granted') gtag('consent', 'update', ${granted});
    else if (choice === 'denied') gtag('consent', 'update', ${denied});
  } catch (e) {}
  gtag('js', new Date());
  gtag('set', 'linker', { domains: ${domains} });
  gtag('config', id, {
    send_page_view: true,
    page_location: window.location.href,
    page_path: window.location.pathname + window.location.search,
    linker: { domains: ${domains}, accept_incoming: true }
  });
  var s = window.document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  window.document.head.appendChild(s);
})());
`.trim();
}

export function gaCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(';')
    .map((part) => part.trim().split('=')[0] ?? '')
    .filter((name) => name === '_ga' || name.startsWith('_ga_') || name === '_gid');
}

/** Host-only and domain-scoped expiry, so a withdrawn choice drops GA cookies. */
export function gaCookieExpiryDirectives(names: string[], hostname: string): string[] {
  const domains = ['', hostname, `.${hostname}`];
  const directives: string[] = [];
  for (const name of names) {
    for (const domain of domains) {
      const domainAttr = domain ? `; domain=${domain}` : '';
      directives.push(`${name}=; Max-Age=0; path=/${domainAttr}`);
    }
  }
  return directives;
}

function clearGaCookies(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const names = gaCookieNames(document.cookie);
  if (names.length === 0) return;
  for (const directive of gaCookieExpiryDirectives(names, window.location.hostname)) {
    document.cookie = directive;
  }
}

/**
 * In-memory choice used only when storage throws. It must not shadow a value
 * localStorage still holds, or a choice made in another tab would stick.
 */
let storageFallback: ConsentChoice | null = null;
let storageFallbackActive = false;

const consentListeners = new Set<() => void>();

function emitConsent(): void {
  consentListeners.forEach((listener) => listener());
}

export function subscribeToConsent(callback: () => void): () => void {
  consentListeners.add(callback);
  if (typeof window === 'undefined') {
    return () => consentListeners.delete(callback);
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONSENT_KEY) callback();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    consentListeners.delete(callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function readStoredConsent(): ConsentChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    storageFallbackActive = false;
    if (value === 'granted' || value === 'denied') return value;
    return null;
  } catch {
    return storageFallbackActive ? storageFallback : null;
  }
}

export type ConsentSnapshot = ConsentChoice | 'unset';

export function getConsentSnapshot(): ConsentSnapshot {
  return readStoredConsent() ?? 'unset';
}

function writeStored(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
    storageFallbackActive = false;
  } catch {
    storageFallbackActive = true;
    storageFallback = choice;
  }
}

export function applyConsent(choice: ConsentChoice, gtagFn?: Gtag): void {
  const fn = gtagFn ?? (typeof window !== 'undefined' ? window.gtag : undefined);
  if (typeof fn !== 'function') return;
  fn('consent', 'update', consentState(choice));
}

export function storeConsent(choice: ConsentChoice, gtagFn?: Gtag): void {
  if (typeof window === 'undefined') return;
  writeStored(choice);
  if (choice === 'denied') clearGaCookies();
  applyConsent(choice, gtagFn);
  emitConsent();
}

/** Drop the remembered choice and return to denied until the visitor decides again. */
export function clearStoredConsent(gtagFn?: Gtag): void {
  if (typeof window === 'undefined') return;
  storageFallbackActive = false;
  storageFallback = null;
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    storageFallbackActive = true;
    storageFallback = null;
  }
  clearGaCookies();
  applyConsent('denied', gtagFn);
  emitConsent();
}

function sender(options?: TrackOptions): Gtag | null {
  const id = options?.id ?? GA_MEASUREMENT_ID;
  if (!isGaConfigured(id)) return null;
  if (options?.gtag) return options.gtag;
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') return window.gtag;
  return null;
}

let lastResult: string | null = null;
let started = false;

export function trackRecommendation(tier: Tier, options?: TrackOptions): void {
  const send = sender(options);
  if (!send) return;
  const tierLabel = tierParam(tier);
  if (lastResult === tierLabel) return;
  lastResult = tierLabel;
  send('event', GA_EVENT.result, { tier: tierLabel });
}

export function trackCalculatorStarted(tier: Tier, options?: TrackOptions): void {
  const send = sender(options);
  if (!send || started) return;
  started = true;
  send('event', GA_EVENT.started, { tier: tierParam(tier) });
}

export function trackOutboundCta(href: string, tier: Tier, options?: TrackOptions): void {
  const send = sender(options);
  if (!send) return;
  send('event', GA_EVENT.outbound, {
    destination: destinationParam(href),
    tier: tierParam(tier),
    transport_type: 'beacon',
  });
}

export function resetAnalyticsForTests(): void {
  lastResult = null;
  started = false;
  storageFallback = null;
  storageFallbackActive = false;
  consentListeners.clear();
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    __vdbcGa?: number;
  }
}
