'use client';

import { useEffect, useRef, useState } from 'react';
import { logPosition } from '@/lib/compute';
import { compactItems } from '@/lib/format';
import type { Tier } from '@/lib/types';
import { useAnimatedNumber } from './useAnimatedNumber';

const ARC_PATH = 'M 16 100 A 77 77 0 0 1 170 100';

const LEGEND: { tier: Tier; label: string; range: string }[] = [
  { tier: 0, label: 'Flat file', range: 'to 1M' },
  { tier: 1, label: 'Keyword index', range: 'any size' },
  { tier: 2, label: 'pgvector', range: 'to 1M' },
  { tier: 3, label: 'Dedicated store', range: '1M+' },
];

interface Props {
  items: number;
  tier: Tier;
  growth: number;
}

/**
 * Semicircular gauge showing where the twelve-month item count sits on the
 * 1K to 100M log scale, with the four tiers as a legend.
 */
export function ScaleGauge({ items, tier, growth }: Props) {
  const pathRef = useRef<SVGPathElement>(null);
  const [arcLength, setArcLength] = useState(0);
  const animated = useAnimatedNumber(items);

  useEffect(() => {
    if (pathRef.current) setArcLength(pathRef.current.getTotalLength());
  }, []);

  const offset = arcLength * (1 - logPosition(items));

  return (
    <div className="card gcard">
      <div className="ch">Where your workload sits</div>
      <div className="cs">items in 12 months, log scale</div>
      <div className="garea">
        <div className="gwrap">
          <svg viewBox="0 0 186 112" role="img" aria-label={`Scale position for ${compactItems(items)} items`}>
            <path className="arc-bg" d={ARC_PATH} />
            <path
              ref={pathRef}
              className="arc-fg"
              d={ARC_PATH}
              style={
                arcLength
                  ? { strokeDasharray: arcLength, strokeDashoffset: offset }
                  : { strokeDasharray: 1, strokeDashoffset: 1 }
              }
            />
          </svg>
          <div className="gcentre">
            <b data-testid="gauge-value">{compactItems(animated)}</b>
            <span>{growth > 1 ? `items, ${growth}x growth` : 'items'}</span>
          </div>
        </div>
        <div className="glegend">
          {LEGEND.map((l) => (
            <div
              key={l.tier}
              className={l.tier === tier ? 'row on' : 'row'}
              data-t={l.tier}
              data-active={l.tier === tier}
            >
              <i />
              {l.label}
              <em>{l.range}</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
