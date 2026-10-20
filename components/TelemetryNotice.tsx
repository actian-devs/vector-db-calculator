'use client';

import { useSyncExternalStore } from 'react';
import { hasOptedOut, isConfigured, setOptedOut, subscribeToOptOut } from '@/lib/telemetry';

/**
 * The disclosure, written as an invitation rather than buried small print.
 *
 * It renders only when an endpoint is actually configured, so the page never
 * claims to send something it does not send. The copy says what is sent and
 * why, without airing internal product discussions on a public page.
 */
export function TelemetryNotice() {
  // Server snapshot is "opted out", so the static HTML contains no claim and
  // the first client render cannot mismatch.
  const optedOut = useSyncExternalStore(
    subscribeToOptOut,
    hasOptedOut,
    () => true,
  );

  if (!isConfigured()) return null;

  return (
    <div className="card tnotice">
      <h3>Help shape what we build next</h3>
      {optedOut ? (
        <p>
          Nothing is being sent. We are trying to understand what people actually size for
          rather than guess at it, so if you change your mind it genuinely helps.
        </p>
      ) : (
        <p>
          The workload you configure is sent to Actian anonymously, with no cookies and
          nothing that identifies you. It tells us what people are really sizing for, which
          settles questions we cannot answer from guesswork. Yours becomes part of that
          evidence.
        </p>
      )}
      <button
        type="button"
        className="opt"
        data-testid="telemetry-toggle"
        onClick={() => setOptedOut(!optedOut)}
      >
        {optedOut ? 'send mine after all' : "don't send mine"}
      </button>
    </div>
  );
}
