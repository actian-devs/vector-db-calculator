'use client';

import { useSyncExternalStore } from 'react';
import { costRange, type CostRange, type MemoryCost } from '@/lib/compute';
import { gbLabel, usd } from '@/lib/format';
import { isStale, PRICES, priceRange, STALE_AFTER_DAYS } from '@/lib/prices';
import type { Assumptions } from '@/lib/types';

interface Props {
  /** Null for tier 1, where a full-text index is small and not sized here. */
  today: MemoryCost | null;
  next: MemoryCost | null;
  assumptions: Assumptions;
}

const PRICED_LABEL = new Date(`${PRICES.pricedAt}T00:00:00Z`).toLocaleDateString(
  'en-US',
  {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  },
);

const noSubscribe = () => () => {};

/** One figure when both ends round the same, so "$67 to $67" never appears. */
function Range({ c, testId }: { c: CostRange; testId?: string }) {
  const low = usd(c.low);
  const high = usd(c.high);
  if (low === high) {
    return (
      <span className="cost-range" data-testid={testId}>
        {low}
      </span>
    );
  }
  return (
    <span className="cost-range" data-testid={testId}>
      {low}
      <span className="hi">
        <em> to </em>
        {high}
      </span>
    </span>
  );
}

/**
 * What the memory behind this workload costs to rent, as a range.
 *
 * Hardware only, from on-demand list prices. It says nothing about any
 * database's price and names no vendor. Tiers 0, 2 and 3 render it the same
 * way so it never tilts toward the paid tier.
 */
export function InfraCostCard({ today, next, assumptions }: Props) {
  // Decided in the browser: the build date and the visit date differ, so the
  // server snapshot is always "fresh" and the client corrects it on hydration.
  const stale = useSyncExternalStore(
    noSubscribe,
    () => isStale(PRICES.pricedAt, new Date()),
    () => false,
  );

  if (!today || !next) {
    return (
      <div className="card ccost" data-testid="cost-card">
        <div className="card-h">WHAT THE MEMORY COSTS</div>
        <p className="cost-none" data-testid="cost-none">
          Full-text indexes are small, so there is no memory estimate for this verdict.
        </p>
      </div>
    );
  }

  const managed =
    PRICES.managedPostgres.length > 0 ? priceRange(PRICES.managedPostgres) : null;
  const managedCost = (gb: number) =>
    managed
      ? costRange(gb, {
          ...assumptions,
          priceLowPerGbMonth: managed.low,
          priceHighPerGbMonth: managed.high,
        })
      : null;

  return (
    <div className="card ccost" data-testid="cost-card">
      <div className="card-h">WHAT THE MEMORY COSTS</div>
      <table className="cost-t">
        <thead>
          <tr>
            <th scope="col">Per month</th>
            <th scope="col">Today</th>
            <th scope="col">In 12 months</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Memory needed</td>
            <td data-testid="cost-gb-today">{gbLabel(today.memoryGb)}</td>
            <td className="grow">{gbLabel(next.memoryGb)}</td>
          </tr>
          <tr>
            <td>Self-managed memory</td>
            <td>
              <Range c={today.monthly} testId="cost-today" />
            </td>
            <td className="grow">
              <Range c={next.monthly} testId="cost-next" />
            </td>
          </tr>
          <tr>
            <td>Midpoint</td>
            <td data-testid="cost-mid-today">{usd(today.monthly.mid)}</td>
            <td className="grow" data-testid="cost-mid-next">
              {usd(next.monthly.mid)}
            </td>
          </tr>
          {managed ? (
            <tr>
              <td>Managed Postgres memory</td>
              <td>
                <Range c={managedCost(today.memoryGb)!} />
              </td>
              <td className="grow">
                <Range c={managedCost(next.memoryGb)!} />
              </td>
            </tr>
          ) : null}
          <tr>
            <td>int8 vectors only</td>
            <td>
              <Range c={today.int8Monthly} />
            </td>
            <td className="grow">
              <Range c={next.int8Monthly} />
            </td>
          </tr>
        </tbody>
      </table>

      <p className="fine cost-note" data-testid="cost-note">
        Memory is vectors x HNSW overhead x headroom, both estimates. Priced{' '}
        {PRICED_LABEL}, on-demand list prices, US regions, per decimal GB (10^9 bytes).
        Hardware only. Not a quote.
      </p>
      {stale ? (
        <p className="cost-stale" role="status" data-testid="cost-stale">
          These prices are more than {STALE_AFTER_DAYS} days old. Treat the figures as a
          rough guide until they are refreshed.
        </p>
      ) : null}
    </div>
  );
}
