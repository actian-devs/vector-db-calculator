'use client';

import { useSyncExternalStore } from 'react';
import {
  clearStoredConsent,
  getConsentSnapshot,
  isGaConfigured,
  storeConsent,
  subscribeToConsent,
} from '@/lib/analytics';

/**
 * Consent Mode is only meaningful once a measurement ID is set. Until then
 * the page has nothing to ask about, and these render nothing.
 */
export function ConsentBanner() {
  const choice = useSyncExternalStore(subscribeToConsent, getConsentSnapshot, () => 'ssr' as const);
  if (!isGaConfigured() || choice !== 'unset') return null;

  return (
    <div className="consent" role="region" aria-label="Analytics consent" data-testid="consent-banner">
      <p>
        We use Google Analytics to see which campaigns reach this calculator and what people do
        here. Analytics cookies stay off unless you accept.
      </p>
      <div className="consent-actions">
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="consent-decline"
          onClick={() => storeConsent('denied')}
        >
          Decline
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="consent-accept"
          onClick={() => storeConsent('granted')}
        >
          Accept analytics
        </button>
      </div>
    </div>
  );
}

export function AnalyticsDisclosure() {
  const choice = useSyncExternalStore(subscribeToConsent, getConsentSnapshot, () => 'ssr' as const);
  if (!isGaConfigured()) return <>No cookies and no analytics.</>;

  return (
    <>
      Optional Google Analytics. Cookies stay off until you accept.
      {choice === 'granted' || choice === 'denied' ? (
        <>
          {' '}
          <button
            type="button"
            className="consent-reopen"
            data-testid="consent-reopen"
            onClick={() => clearStoredConsent()}
          >
            Change analytics choice
          </button>
        </>
      ) : null}
    </>
  );
}
