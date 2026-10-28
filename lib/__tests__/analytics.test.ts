import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_KEY,
  GA_EVENT,
  GA_LINKER_DOMAINS,
  GA_MEASUREMENT_ID,
  GA_MEASUREMENT_ID_PLACEHOLDER,
  analyticsBootstrap,
  applyConsent,
  clearStoredConsent,
  consentState,
  destinationParam,
  gaCookieExpiryDirectives,
  gaCookieNames,
  isGaConfigured,
  readStoredConsent,
  resetAnalyticsForTests,
  storeConsent,
  tierParam,
  trackCalculatorStarted,
  trackOutboundCta,
  trackRecommendation,
} from '../analytics';

const REAL_ID = 'G-TEST1234';
const PAGES_URL =
  'https://actian-devs.github.io/vector-db-calculator/?utm_source=newsletter&utm_medium=email&utm_campaign=vectordb_calculator_oct';

interface FakeScript {
  async: boolean;
  src: string;
}

function runBootstrap(
  measurementId: string,
  href: string,
  stored: string | null,
): { dataLayer: unknown[][]; scripts: FakeScript[]; window: Window } {
  const source = analyticsBootstrap(measurementId);
  expect(source).not.toBeNull();
  const url = new URL(href);
  const scripts: FakeScript[] = [];
  const win: Record<string, unknown> = {
    location: { href: url.href, pathname: url.pathname, search: url.search },
    localStorage: { getItem: () => stored },
    document: {
      createElement: () => ({ async: false, src: '' }),
      head: { appendChild: (node: FakeScript) => scripts.push(node) },
    },
  };
  win.window = win;
  runInNewContext(source as string, win);
  const dataLayer = ((win.dataLayer as unknown[]) ?? []).map((entry) =>
    Array.from(entry as ArrayLike<unknown>),
  );
  return { dataLayer, scripts, window: win as unknown as Window };
}

function command(dataLayer: unknown[][], name: string, arg: string): unknown[] | undefined {
  return dataLayer.find((entry) => entry[0] === name && entry[1] === arg);
}

afterEach(() => {
  resetAnalyticsForTests();
  vi.unstubAllGlobals();
});

describe('measurement ID', () => {
  it('treats the placeholder as off and a blank or Universal ID as off', () => {
    // Widen the literal so filling in a real measurement ID does not fail typecheck.
    const configuredId: string = GA_MEASUREMENT_ID;
    expect(configuredId === GA_MEASUREMENT_ID_PLACEHOLDER || isGaConfigured(configuredId)).toBe(
      true,
    );
    expect(isGaConfigured(GA_MEASUREMENT_ID_PLACEHOLDER)).toBe(false);
    expect(analyticsBootstrap(GA_MEASUREMENT_ID_PLACEHOLDER)).toBeNull();
    expect(analyticsBootstrap('')).toBeNull();
    expect(analyticsBootstrap('UA-251080951-1')).toBeNull();
    expect(analyticsBootstrap('not-an-id')).toBeNull();
  });

  it('accepts a real GA4 measurement ID', () => {
    expect(isGaConfigured(REAL_ID)).toBe(true);
    expect(isGaConfigured(`  ${REAL_ID}  `)).toBe(true);
  });
});

describe('consent mode', () => {
  it('defaults every storage flag to denied except security', () => {
    expect(consentState('denied')).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
      functionality_storage: 'denied',
      personalization_storage: 'denied',
      security_storage: 'granted',
    });
  });

  it('grants the same flags on accept', () => {
    const granted = consentState('granted');
    expect(granted.analytics_storage).toBe('granted');
    expect(granted.ad_storage).toBe('granted');
    expect(granted.ad_user_data).toBe('granted');
    expect(granted.ad_personalization).toBe('granted');
    expect(granted.security_storage).toBe('granted');
  });

  it('remembers the choice under its own key and can withdraw it', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
      location: { hostname: 'actian-devs.github.io' },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal('document', { cookie: '' });

    expect(readStoredConsent()).toBeNull();
    storeConsent('granted');
    expect(store.get(CONSENT_KEY)).toBe('granted');
    expect(CONSENT_KEY).not.toBe('vdbc:telemetry-opt-out');
    expect(readStoredConsent()).toBe('granted');

    clearStoredConsent();
    expect(store.has(CONSENT_KEY)).toBe(false);
    expect(readStoredConsent()).toBeNull();
  });

  it('keeps the choice in memory when storage is blocked', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
      location: { hostname: 'localhost' },
    });
    vi.stubGlobal('document', { cookie: '' });
    storeConsent('denied');
    expect(readStoredConsent()).toBe('denied');
  });

  it('updates consent through gtag', () => {
    const calls: unknown[][] = [];
    applyConsent('granted', (...args) => calls.push(args));
    expect(calls).toEqual([['consent', 'update', consentState('granted')]]);
  });

  it('expires GA cookies and leaves every other cookie alone', () => {
    expect(gaCookieNames('_ga=1; theme=light; _ga_ABC=2; _gid=3; session=1')).toEqual([
      '_ga',
      '_ga_ABC',
      '_gid',
    ]);
    expect(gaCookieExpiryDirectives(['_ga'], 'actian-devs.github.io')).toEqual([
      '_ga=; Max-Age=0; path=/',
      '_ga=; Max-Age=0; path=/; domain=actian-devs.github.io',
      '_ga=; Max-Age=0; path=/; domain=.actian-devs.github.io',
    ]);
  });
});

describe('bootstrap', () => {
  it('sends one pageview with the subpath and the incoming UTMs, before gtag.js loads', () => {
    const { dataLayer, scripts } = runBootstrap(REAL_ID, PAGES_URL, null);
    const defaults = command(dataLayer, 'consent', 'default');
    expect(defaults?.[2]).toEqual(consentState('denied'));
    expect(command(dataLayer, 'consent', 'update')).toBeUndefined();

    const config = dataLayer.find((entry) => entry[0] === 'config');
    expect(config?.[1]).toBe(REAL_ID);
    expect(config?.[2]).toMatchObject({
      send_page_view: true,
      page_location: PAGES_URL,
      page_path:
        '/vector-db-calculator/?utm_source=newsletter&utm_medium=email&utm_campaign=vectordb_calculator_oct',
      linker: { domains: [...GA_LINKER_DOMAINS], accept_incoming: true },
    });
    expect(dataLayer.find((entry) => entry[0] === 'set' && entry[1] === 'linker')?.[2]).toEqual({
      domains: [...GA_LINKER_DOMAINS],
    });
    expect(dataLayer.find((entry) => entry[0] === 'set' && entry[1] === 'ads_data_redaction')?.[2]).toBe(
      true,
    );
    expect(dataLayer.some((entry) => entry[0] === 'event' && entry[1] === 'page_view')).toBe(false);

    const configAt = dataLayer.findIndex((entry) => entry[0] === 'config');
    const consentAt = dataLayer.findIndex((entry) => entry[0] === 'consent');
    expect(consentAt).toBeGreaterThanOrEqual(0);
    expect(consentAt).toBeLessThan(configAt);

    expect(scripts).toEqual([
      {
        async: true,
        src: `https://www.googletagmanager.com/gtag/js?id=${REAL_ID}`,
      },
    ]);
  });

  it('applies a stored grant before the pageview and a stored denial as an update', () => {
    const granted = runBootstrap(REAL_ID, PAGES_URL, 'granted');
    const update = command(granted.dataLayer, 'consent', 'update');
    expect(update?.[2]).toEqual(consentState('granted'));
    const updateAt = granted.dataLayer.indexOf(update as unknown[]);
    const configAt = granted.dataLayer.findIndex((entry) => entry[0] === 'config');
    expect(updateAt).toBeLessThan(configAt);

    const denied = runBootstrap(REAL_ID, 'http://127.0.0.1:3000/?utm_campaign=vectordb_calculator_oct', 'denied');
    expect(command(denied.dataLayer, 'consent', 'update')?.[2]).toEqual(consentState('denied'));
    const config = denied.dataLayer.find((entry) => entry[0] === 'config');
    expect(config?.[2]).toMatchObject({
      page_location: 'http://127.0.0.1:3000/?utm_campaign=vectordb_calculator_oct',
      page_path: '/?utm_campaign=vectordb_calculator_oct',
    });
  });

  it('does not bootstrap twice', () => {
    const source = analyticsBootstrap(REAL_ID);
    const url = new URL(PAGES_URL);
    const scripts: FakeScript[] = [];
    const win: Record<string, unknown> = {
      location: { href: url.href, pathname: url.pathname, search: url.search },
      localStorage: { getItem: () => null },
      document: {
        createElement: () => ({ async: false, src: '' }),
        head: { appendChild: (node: FakeScript) => scripts.push(node) },
      },
    };
    win.window = win;
    runInNewContext(source as string, win);
    runInNewContext(source as string, win);
    expect(scripts).toHaveLength(1);
    expect(
      ((win.dataLayer as unknown[]) ?? []).filter((entry) => Array.from(entry as ArrayLike<unknown>)[0] === 'config'),
    ).toHaveLength(1);
  });
});

describe('events', () => {
  function capture(id = REAL_ID) {
    const calls: unknown[][] = [];
    const gtag = (...args: unknown[]) => calls.push(args);
    return { calls, options: { id, gtag } };
  }

  it('does nothing while the measurement ID is the placeholder', () => {
    const { calls, options } = capture(GA_MEASUREMENT_ID_PLACEHOLDER);
    trackRecommendation(3, options);
    trackCalculatorStarted(3, options);
    trackOutboundCta('https://www.actian.com/databases/', 3, options);
    expect(calls).toEqual([]);
  });

  it('records the settled tier, the first interaction, and an outbound click', () => {
    const { calls, options } = capture();
    trackRecommendation(0, options);
    trackRecommendation(0, options);
    trackRecommendation(3, options);
    trackRecommendation(0, options);
    trackCalculatorStarted(0, options);
    trackCalculatorStarted(2, options);
    trackOutboundCta(
      'https://www.actian.com/databases/vectorai-db/community-edition/?utm_source=vector-db-calculator&utm_medium=hub&utm_campaign=vectordb_calculator_oct&utm_content=tier-3',
      3,
      options,
    );

    expect(calls).toEqual([
      ['event', GA_EVENT.result, { tier: 'tier-0' }],
      ['event', GA_EVENT.result, { tier: 'tier-3' }],
      ['event', GA_EVENT.result, { tier: 'tier-0' }],
      ['event', GA_EVENT.started, { tier: 'tier-0' }],
      [
        'event',
        GA_EVENT.outbound,
        {
          destination: 'www.actian.com/databases/vectorai-db/community-edition/',
          tier: 'tier-3',
          transport_type: 'beacon',
        },
      ],
    ]);
  });

  it('keeps event parameters to the tier and the destination', () => {
    expect(tierParam(0)).toBe('tier-0');
    expect(tierParam(1)).toBe('tier-1');
    expect(tierParam(2)).toBe('tier-2');
    expect(tierParam(3)).toBe('tier-3');
    const destination = destinationParam(
      'https://www.actian.com/blog/developer/state-of-vector-databases-q2-2026/?utm_campaign=example',
    );
    expect(destination).toBe('www.actian.com/blog/developer/state-of-vector-databases-q2-2026/');
    expect(destination.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify({ tier: tierParam(2), destination })).not.toContain('priceHigh');
  });
});
