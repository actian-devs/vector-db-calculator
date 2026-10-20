'use client';

import { bytes, compactItems, scanRange } from '@/lib/format';
import type { Footprint } from '@/lib/types';
import { useAnimatedNumber } from './useAnimatedNumber';

function Bytes({ value }: { value: number }) {
  const v = useAnimatedNumber(value);
  const { value: num, unit } = bytes(v);
  return (
    <>
      {num}
      <em>{unit}</em>
    </>
  );
}

function Count({ value }: { value: number }) {
  return <>{compactItems(useAnimatedNumber(value))}</>;
}

function Scan({ low, high }: { low: number; high: number }) {
  const l = useAnimatedNumber(low);
  const h = useAnimatedNumber(high);
  const { value, unit } = scanRange(l, h);
  return (
    <>
      {value}
      <em>{unit}</em>
    </>
  );
}

interface Props {
  today: Footprint;
  next: Footprint;
  growth: number;
}

/**
 * Today against twelve months out. Showing both is the point: growth is
 * otherwise invisible, folded silently into a single number.
 */
export function CostTable({ today, next, growth }: Props) {
  return (
    <div className="card tcard">
      <table>
        <thead>
          <tr>
            <th scope="col">What it costs you</th>
            <th scope="col">Today</th>
            <th scope="col">{growth > 1 ? 'In 12 months' : 'In 12 months'}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Raw vectors, float32</td>
            <td>
              <Bytes value={today.float32Bytes} />
            </td>
            <td className="grow" data-testid="mem-next">
              <Bytes value={next.float32Bytes} />
            </td>
          </tr>
          <tr>
            <td>Same vectors at int8</td>
            <td>
              <Bytes value={today.int8Bytes} />
            </td>
            <td className="grow">
              <Bytes value={next.int8Bytes} />
            </td>
          </tr>
          <tr>
            <td>Comparisons per query</td>
            <td>
              <Count value={today.comparisons} />
            </td>
            <td className="grow">
              <Count value={next.comparisons} />
            </td>
          </tr>
          <tr>
            <td>Brute-force scan</td>
            <td>
              <Scan low={today.scanMsLow} high={today.scanMsHigh} />
            </td>
            <td className="grow">
              <Scan low={next.scanMsLow} high={next.scanMsHigh} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
